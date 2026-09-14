import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { DbRouter } from "../database/db-router";
import { withTenantContext } from "../database/tenant-context";
import { membershipLookup, memberships, tenants, users } from "../database/schema";
import { TenantsService } from "../tenants/tenants.service";
import { UsersService } from "../users/users.service";
import { TokenService } from "./token.service";

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: "owner" | "staff";
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const PASSWORD_HASH_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly dbRouter: DbRouter,
    private readonly tenantsService: TenantsService,
    private readonly usersService: UsersService,
    private readonly jwt: JwtService,
    private readonly tokens: TokenService,
  ) {}

  /** Self-service merchant onboarding: creates a new store, its first (owner) user, and their membership. */
  async register(input: {
    storeName: string;
    storeSlug: string;
    email: string;
    password: string;
    name: string;
  }) {
    if (await this.tenantsService.findBySlug(input.storeSlug)) {
      throw new ConflictException("Store slug already taken");
    }
    if (await this.usersService.findByEmail(input.email)) {
      throw new ConflictException("Email already registered");
    }

    const passwordHash = await bcrypt.hash(input.password, PASSWORD_HASH_ROUNDS);

    // A write, unconditionally on primary. The tenant doesn't exist until
    // this transaction runs, so tenant context can't be set up front —
    // set it right after the tenant is created, before the one
    // RLS-protected insert (memberships) happens.
    const { tenant, user, membership } = await this.dbRouter.write((db) =>
      db.transaction(async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({ name: input.storeName, slug: input.storeSlug })
          .returning();
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, passwordHash, name: input.name })
          .returning();
        await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenant.id}, true)`);
        const [membership] = await tx
          .insert(memberships)
          .values({ tenantId: tenant.id, userId: user.id, role: "owner" })
          .returning();
        // membership_lookup has no RLS, so this insert runs on the same
        // connection/transaction without needing app.tenant_id at all —
        // it's not tenant-owned data, it's the index that makes
        // identify() possible. Keep it in the same transaction as the
        // memberships insert so the two can never drift.
        await tx.insert(membershipLookup).values({ userId: user.id, tenantId: tenant.id });
        return { tenant, user, membership };
      }),
    );

    return {
      tokens: await this.issueTokens(tenant.id, {
        sub: user.id,
        tenantId: tenant.id,
        role: membership.role,
        email: user.email,
      }),
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  /**
   * Which store(s) an email belongs to — lets the login form resolve the
   * tenant itself instead of asking the person to type a slug by hand.
   * Reads membership_lookup directly (no withTenantContext — that table
   * has no RLS, see its own schema comment for why that's the point).
   * Returns [] for both "no such email" and "email exists but somehow has
   * no memberships" — deliberately not distinguished, so this doesn't
   * become a stronger account-existence oracle than it already is by
   * necessity. AuthController rate-limits this the same way OTP requests
   * are rate-limited.
   */
  async identify(email: string): Promise<{ slug: string; name: string }[]> {
    const user = await this.usersService.findByEmail(email);
    if (!user) return [];

    return this.dbRouter.read("strong", (db) =>
      db
        .select({ slug: tenants.slug, name: tenants.name })
        .from(membershipLookup)
        .innerJoin(tenants, eq(membershipLookup.tenantId, tenants.id))
        .where(eq(membershipLookup.userId, user.id)),
    );
  }

  /** Logs a user into the store resolved from the request (hostname/dev header) — never a store named in the request body. */
  async login(input: { email: string; password: string; tenantId: string }) {
    const user = await this.usersService.findByEmail(input.email);
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Membership is tenant-owned data and gates auth — always strong, never
    // "eventual". withTenantContext still does the RLS work; DbRouter only
    // decides which physical connection that transaction runs on.
    const membership = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, input.tenantId, async (tx) => {
        const [m] = await tx.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
        return m ?? null;
      }),
    );
    if (!membership) {
      throw new UnauthorizedException("No access to this store");
    }

    return {
      // membership.tenantId, not input.tenantId: the JWT's tenant claim
      // must come from the row we actually verified, not the value we
      // asked RLS to filter by — if RLS were ever misconfigured (as it
      // was, until the folkshops_app role fix) this is the layer that
      // still stops a cross-tenant token from being issued.
      tokens: await this.issueTokens(membership.tenantId, {
        sub: user.id,
        tenantId: membership.tenantId,
        role: membership.role,
        email: user.email,
      }),
    };
  }

  /**
   * Exchanges a refresh token cookie for a fresh access+refresh pair.
   * Re-derives the membership/role from the DB rather than trusting
   * anything cached in the old token — a role change or removed membership
   * takes effect the next time this runs, not just at next full login.
   */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const invalidMsg = "Invalid or expired refresh token";
    const consumed = await this.tokens.consumeRefreshToken("staff", rawRefreshToken);
    if (!consumed || !consumed.tenantId) throw new UnauthorizedException(invalidMsg);

    const user = await this.usersService.findById(consumed.subjectId);
    if (!user) throw new UnauthorizedException(invalidMsg);

    const membership = await this.dbRouter.read("strong", (db) =>
      withTenantContext(db, consumed.tenantId!, async (tx) => {
        const [m] = await tx.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
        return m ?? null;
      }),
    );
    if (!membership) throw new UnauthorizedException(invalidMsg);

    return this.issueTokens(membership.tenantId, {
      sub: user.id,
      tenantId: membership.tenantId,
      role: membership.role,
      email: user.email,
    });
  }

  /** Not an error if the token is already gone/invalid — logout should always succeed from the client's point of view. */
  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokens.revokeToken(rawRefreshToken);
  }

  private async issueTokens(tenantId: string, accessPayload: JwtPayload): Promise<TokenPair> {
    const accessToken = this.jwt.sign(accessPayload);
    const refreshToken = await this.tokens.issueRefreshToken("staff", accessPayload.sub, tenantId);
    return { accessToken, refreshToken };
  }
}

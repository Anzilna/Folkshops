import { ConflictException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { DRIZZLE, Db } from "../database/database.module";
import { withTenantContext } from "../database/tenant-context";
import { memberships, tenants, users } from "../database/schema";
import { TenantsService } from "../tenants/tenants.service";
import { UsersService } from "../users/users.service";

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: "owner" | "staff";
  email: string;
}

const PASSWORD_HASH_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly tenantsService: TenantsService,
    private readonly usersService: UsersService,
    private readonly jwt: JwtService,
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

    // The tenant doesn't exist until this transaction runs, so tenant
    // context can't be set up front — set it right after the tenant is
    // created, before the one RLS-protected insert (memberships) happens.
    const { tenant, user, membership } = await this.db.transaction(async (tx) => {
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
      return { tenant, user, membership };
    });

    return {
      accessToken: this.issueToken({
        sub: user.id,
        tenantId: tenant.id,
        role: membership.role,
        email: user.email,
      }),
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  /** Logs a user into the store resolved from the request (hostname/dev header) — never a store named in the request body. */
  async login(input: { email: string; password: string; tenantId: string }) {
    const user = await this.usersService.findByEmail(input.email);
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid credentials");
    }

    // Membership is tenant-owned data — go through withTenantContext so
    // Postgres RLS enforces the scoping too, not just this WHERE clause.
    const membership = await withTenantContext(this.db, input.tenantId, async (tx) => {
      const [m] = await tx.select().from(memberships).where(eq(memberships.userId, user.id)).limit(1);
      return m ?? null;
    });
    if (!membership) {
      throw new UnauthorizedException("No access to this store");
    }

    return {
      // membership.tenantId, not input.tenantId: the JWT's tenant claim
      // must come from the row we actually verified, not the value we
      // asked RLS to filter by — if RLS were ever misconfigured (as it
      // was, until the folkshops_app role fix) this is the layer that
      // still stops a cross-tenant token from being issued.
      accessToken: this.issueToken({
        sub: user.id,
        tenantId: membership.tenantId,
        role: membership.role,
        email: user.email,
      }),
    };
  }

  private issueToken(payload: JwtPayload): string {
    return this.jwt.sign(payload);
  }
}

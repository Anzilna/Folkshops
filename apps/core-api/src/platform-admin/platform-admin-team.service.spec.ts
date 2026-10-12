import { ConflictException, NotFoundException } from "@nestjs/common";
import { PlatformAdminTeamService } from "./team/platform-admin-team.service";

/**
 * The decision rules in remove(), against a scripted transaction. The
 * locking that makes them race-safe is covered against real Postgres in
 * platform-admin-management.integration.spec.ts.
 */
function build(rows: { id: string; email: string }[]) {
  const deleted: string[] = [];
  const recorded: unknown[] = [];
  const tx = {
    select: () => ({ from: () => ({ orderBy: () => ({ for: async () => rows }) }) }),
    delete: () => ({ where: async () => deleted.push("deleted") }),
  };
  const dbRouter = { write: async (fn: (db: unknown) => unknown) => fn({ transaction: (cb: (t: unknown) => unknown) => cb(tx) }) };
  const audit = { record: async (...args: unknown[]) => recorded.push(args) };
  const tokens = { revokeAllForSubjectIn: async () => undefined };
  const service = new PlatformAdminTeamService(dbRouter as never, {} as never, audit as never, tokens as never, { publish: async () => 0 } as never);
  return { service, deleted, recorded };
}

const actor = { sub: "11111111-1111-4111-8111-111111111111", email: "me@test.local" };

test("removing yourself is refused before touching the database", async () => {
  const { service, deleted } = build([]);
  await expect(service.remove(actor, actor.sub)).rejects.toThrow("own account");
  expect(deleted).toEqual([]);
});

test("removing someone who isn't there is a 404", async () => {
  const { service } = build([{ id: actor.sub, email: actor.email }]);
  await expect(service.remove(actor, "22222222-2222-4222-8222-222222222222")).rejects.toBeInstanceOf(NotFoundException);
});

test("the last remaining admin can never be removed", async () => {
  const target = { id: "22222222-2222-4222-8222-222222222222", email: "last@test.local" };
  const { service, deleted, recorded } = build([target]);
  await expect(service.remove(actor, target.id)).rejects.toBeInstanceOf(ConflictException);
  expect(deleted).toEqual([]);
  expect(recorded).toEqual([]);
});

test("with another admin remaining, removal deletes and audits", async () => {
  const target = { id: "22222222-2222-4222-8222-222222222222", email: "gone@test.local" };
  const { service, deleted, recorded } = build([{ id: actor.sub, email: actor.email }, target]);
  await service.remove(actor, target.id);
  expect(deleted).toHaveLength(1);
  expect(recorded).toHaveLength(1);
});

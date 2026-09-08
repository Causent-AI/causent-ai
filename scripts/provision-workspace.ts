/** Explicit operator provisioning. Does not create credentials or send invites.
 * node --env-file=.env.local --experimental-strip-types scripts/provision-workspace.ts \
 *   create <request-uuid> <existing-owner-uuid> <organization> <project> <workspace>
 * Use archive <workspace-uuid> or restore <workspace-uuid> for lifecycle changes.
 */
import { createClient } from "@supabase/supabase-js";

const [command, ...args] = process.argv.slice(2);
const uuid = (value: string | undefined) => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
if (!(command === "create" && args.length === 5 && uuid(args[0]) && uuid(args[1])) &&
    !(["archive", "restore"].includes(command) && args.length === 1 && uuid(args[0]))) {
  throw new Error("Usage: create <request UUID> <owner UUID> <organization> <project> <workspace>, or archive|restore <workspace UUID>");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Operator Supabase URL and service-role key are required.");
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const response = command === "create"
  ? await client.rpc("provision_customer_workspace_v1", {
      p_request_id: args[0], p_owner: args[1], p_organization: args[2], p_project: args[3], p_workspace: args[4],
    })
  : await client.rpc("set_customer_workspace_archived_v1", { p_scope_id: args[0], p_archived: command === "archive" });
if (response.error) throw new Error(`Workspace operation failed (${response.error.code}). Check owner, request identity and names.`);
console.log(JSON.stringify({ operation: command, workspaceId: command === "create" ? response.data : args[0],
  ...(command === "create" ? { requestId: args[0] } : {}) }));

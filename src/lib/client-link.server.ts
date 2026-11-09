// Núcleo testável de linkClientAccount, separado de clientPortal.functions.ts
// (que importa createServerFn/@tanstack e o middleware de auth por alias
// "@/...", inviável de importar direto num `node --test` sem bundler) — só
// imports relativos aqui, mesmo padrão já usado pelos outros arquivos
// *.server.ts testáveis deste projeto (ex.: central-reminder-scheduler.server.ts).
import { LOGIN_STEP, failWithSupportCode } from "./login-support-code.server.ts";

type SupabaseAdmin = Awaited<
  typeof import("../integrations/supabase/client.server")
>["supabaseAdmin"];

export type ClientRow = {
  id: string;
  owner_id: string;
  full_name: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  cpf: string | null;
};

export type LinkInputData = {
  owner_id: string;
  full_name?: string;
  email?: string;
  birthday?: string;
  cpf?: string;
  how_found?: string;
  accepted_terms?: boolean;
};

export type LinkClientAccountDeps = {
  /** Encapsula a Auth admin API (getUserById) — isolada pra ser testável com
   * um dublê, sem precisar simular `.auth.admin.*` no banco fake. Devolve
   * null quando não for possível confirmar o telefone (conta inexistente,
   * erro da Auth API, ou usuária sem telefone). */
  getPhoneForUser: (userId: string) => Promise<string | null>;
};

// Item 1.6 da FASE G6.2-E: nunca repassar `error.message` do PostgREST/banco
// pro toast da cliente (é assim que o erro técnico "JSON object requested,
// multiple (or no) rows returned" chegava crua na tela). Detalhe completo só
// no console do servidor, sem telefone/código. Item 1.1 da FASE G6.2-F: toda
// falha deste passo ("vincular cliente") leva o mesmo código de suporte L07.
const GENERIC_FAIL_MSG = "Não foi possível concluir agora. Tente de novo em instantes.";

function failInternal(_context: string, error: unknown): never {
  failWithSupportCode(GENERIC_FAIL_MSG, LOGIN_STEP.CLIENT_LINK, error);
}

/**
 * Registra (sem telefone, nome ou qualquer PII) que havia mais de uma linha
 * de `clients` batendo com o mesmo critério — pra a dona decidir a limpeza
 * depois, sem que este código decida apagar ou unir nada por conta própria.
 */
async function logDuplicateClients(
  supabaseAdmin: SupabaseAdmin,
  ownerId: string,
  scope: "vinculada_ao_mesmo_usuario" | "orfa_mesmo_telefone",
  count: number,
  chosenClientId: string,
): Promise<void> {
  await supabaseAdmin.from("audit_log").insert({
    owner_id: ownerId,
    action: "client_duplicate_detected",
    resource: "client",
    resource_id: chosenClientId,
    details: { scope, count } as never,
  } as never);
}

const CLIENT_COLUMNS = "id, owner_id, full_name, phone, email, birthday, cpf";

/**
 * Vincula a cliente autenticada (telefone verificado via OTP) à sua linha em
 * public.clients para o salão identificado por owner_id, criando essa linha
 * na primeira visita se necessário.
 *
 * DEFEITO CORRIGIDO (FASE G6.2-E, 08/11/2026): as duas buscas abaixo podiam
 * legitimamente devolver 0, 1 ou MAIS de 1 linha (telefone de teste repetido
 * deixou clientes órfãos duplicados) — `.maybeSingle()` só perdoa 0 linhas;
 * com 2+ linhas ele lança exatamente "JSON object requested, multiple (or
 * no) rows returned" (confirmado lendo @supabase/postgrest-js instalado),
 * que chegava cru no toast da cliente. Agora pedimos a lista inteira
 * (ordenada por created_at) e tratamos 0/1/N nós mesmos, sem nunca apagar ou
 * unir linhas — só registramos a duplicidade em audit_log pra a dona
 * decidir a limpeza depois. Critério determinístico: a linha MAIS ANTIGA é
 * a escolhida, por ser a que mais provavelmente corresponde ao primeiro
 * cadastro real.
 */
export async function linkClientAccountCore(
  supabaseAdmin: SupabaseAdmin,
  deps: LinkClientAccountDeps,
  userId: string,
  data: LinkInputData,
): Promise<{ client: ClientRow; created: boolean }> {
  const phone = await deps.getPhoneForUser(userId);
  if (!phone) {
    throw new Error("Não foi possível confirmar o telefone da conta.");
  }

  const { data: byUserRows, error: byUserErr } = await supabaseAdmin
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("owner_id", data.owner_id)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (byUserErr) failInternal("Falha ao buscar cliente vinculada", byUserErr);
  if (byUserRows && byUserRows.length > 0) {
    if (byUserRows.length > 1) {
      await logDuplicateClients(
        supabaseAdmin,
        data.owner_id,
        "vinculada_ao_mesmo_usuario",
        byUserRows.length,
        byUserRows[0].id,
      );
    }
    return { client: byUserRows[0] as ClientRow, created: false };
  }

  const { data: byPhoneRows, error: byPhoneErr } = await supabaseAdmin
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("owner_id", data.owner_id)
    .eq("phone", phone)
    .is("user_id", null)
    .order("created_at", { ascending: true });
  if (byPhoneErr) failInternal("Falha ao buscar cliente órfã pelo telefone", byPhoneErr);

  if (byPhoneRows && byPhoneRows.length > 0) {
    if (byPhoneRows.length > 1) {
      await logDuplicateClients(
        supabaseAdmin,
        data.owner_id,
        "orfa_mesmo_telefone",
        byPhoneRows.length,
        byPhoneRows[0].id,
      );
    }
    const chosen = byPhoneRows[0];
    const { data: updated, error } = await supabaseAdmin
      .from("clients")
      .update({ user_id: userId })
      .eq("id", chosen.id)
      .select(CLIENT_COLUMNS)
      .single();
    if (error) failInternal("Falha ao vincular cliente órfã existente", error);
    return { client: updated as ClientRow, created: false };
  }

  if (!data.full_name) {
    throw new Error("Nome é obrigatório para o primeiro cadastro.");
  }
  if (!data.accepted_terms) {
    throw new Error(
      "É preciso aceitar os Termos de Uso e a Política de Privacidade para continuar.",
    );
  }

  const { data: created, error: createErr } = await supabaseAdmin
    .from("clients")
    .insert({
      owner_id: data.owner_id,
      user_id: userId,
      full_name: data.full_name,
      phone,
      email: data.email || null,
      birthday: data.birthday || null,
      cpf: data.cpf || null,
      how_found: data.how_found || null,
      terms_accepted_at: new Date().toISOString(),
    })
    .select("id, owner_id, full_name, phone, email, birthday, cpf")
    .single();
  if (createErr) failInternal("Falha ao criar cadastro de cliente", createErr);
  return { client: created as ClientRow, created: true };
}

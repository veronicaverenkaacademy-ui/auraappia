import { useQuery } from "@tanstack/react-query";
import { useCurrentRole, useSelfMember } from "@/hooks/use-role";
import { getAccessLevelKind, listAccessLevelPermissions } from "@/lib/team";
import type { Resource, Action } from "@/lib/permissions";

/**
 * Decide o que a pessoa logada pode ver/fazer, a partir de access_level_permissions
 * (a mesma tabela já usada pelo staff_can() no banco). A dona nunca paga o custo desta
 * query — canDo/canView retornam true direto pra ela sem esperar nada.
 *
 * isLoading só fica true enquanto uma resposta de staff ainda está em aberto — usar
 * pra não renderizar itens condicionais antes da permissão real ser conhecida (evita
 * "aparece tudo e depois some").
 */
export function useStaffPermissions() {
  const { data: role, isLoading: roleLoading } = useCurrentRole();
  const { data: selfMember, isLoading: memberLoading } = useSelfMember();

  const isAdmin = role === "admin";
  const isStaff = role === "staff";
  const accessLevelId = selfMember?.access_level_id ?? null;

  const { data: permissions, isLoading: permissionsLoading } = useQuery({
    queryKey: ["access-level-permissions", accessLevelId],
    queryFn: () => listAccessLevelPermissions(accessLevelId as string),
    enabled: isStaff && !!accessLevelId,
    staleTime: 60_000,
  });

  // kind ('global' | 'own') decide se a pessoa vê o negócio inteiro ou só o próprio
  // recorte (ex: Profissional). Query pequena e independente da de permissões — não
  // duplica a leitura de access_level_permissions, só busca a coluna kind por PK.
  const { data: kind, isLoading: kindLoading } = useQuery({
    queryKey: ["access-level-kind", accessLevelId],
    queryFn: () => getAccessLevelKind(accessLevelId as string),
    enabled: isStaff && !!accessLevelId,
    staleTime: 60_000,
  });

  const isLoading =
    roleLoading ||
    (isStaff && (memberLoading || (!!accessLevelId && (permissionsLoading || kindLoading))));

  const canDo = (resource: Resource, action: Action = "view"): boolean => {
    if (isAdmin) return true;
    if (!permissions) return false;
    return permissions.some((p) => p.resource === resource && p.action === action && p.allowed);
  };

  const canView = (resource: Resource) => canDo(resource, "view");

  // Admin nunca é 'own' — o conceito só existe pra distinguir níveis de staff entre si.
  const isOwnKind = isStaff && kind === "own";

  return { role, isAdmin, isStaff, canDo, canView, isLoading, kind, isOwnKind };
}

import { useQuery } from "@tanstack/react-query";
import { getCurrentRole, getSelfTeamMember } from "@/lib/team";

export function useCurrentRole() {
  return useQuery({
    queryKey: ["current-role"],
    queryFn: getCurrentRole,
    staleTime: 60_000,
  });
}

export function useSelfMember() {
  return useQuery({
    queryKey: ["self-member"],
    queryFn: getSelfTeamMember,
    staleTime: 30_000,
  });
}
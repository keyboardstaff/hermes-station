import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface MemoryFact {
  fact_id: number;
  content: string;
  category?: string;
  tags?: string;
  trust_score?: number;
  retrieval_count?: number;
  helpful_count?: number;
  created_at?: string;
  updated_at?: string;
}

interface MemoryResponse {
  available: boolean;
  facts: MemoryFact[];
}

/** Structured memory (data sovereignty): list + forget facts the agent stored.
 *  Backed by the holographic provider's per-profile memory_store.db. */
export function useMemory() {
  const qc = useQueryClient();

  const query = useQuery<MemoryResponse>({
    queryKey: ["memory"],
    queryFn: async () => {
      const r = await fetch("/api/memory");
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json();
    },
    staleTime: 10_000,
  });

  const forget = useMutation({
    mutationFn: async (factId: number) => {
      const r = await fetch(`/api/memory/${factId}`, {
        method: "DELETE",
        headers: { "X-HMS-CSRF": "1" },
      });
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ removed: boolean }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["memory"] }),
  });

  return { query, forget };
}

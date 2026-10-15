import { useEffect, useRef, useState } from "react";
import type { QueryInput } from "../shared/contracts";
import { api } from "./ui";
import { QueryCountRequest } from "./query-count";

export function useQueryCount(query: QueryInput, enabled: boolean) {
  const [count, setCount] = useState<number>();
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState("");
  const request = useRef(new QueryCountRequest());
  const key = JSON.stringify([
    query.connectionId,
    query.database,
    query.collection,
    query.filter,
    enabled,
  ]);
  useEffect(() => {
    request.current.invalidate();
    setCount(undefined);
    setCountError("");
    setCounting(false);
    return () => request.current.invalidate();
  }, [key]);
  const countDocuments = async () => {
    if (!enabled || counting) return;
    setCounting(true);
    setCountError("");
    const result = await request.current.run(() =>
      api.request("queries.count", query),
    );
    if (result.stale) return;
    setCounting(false);
    if (result.error !== undefined) {
      setCount(undefined);
      setCountError(result.error);
    } else setCount(result.count);
  };
  return { count, counting, countError, countDocuments };
}

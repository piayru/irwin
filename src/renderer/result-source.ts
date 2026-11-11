import type { Row } from "../shared/contracts";

export function editableResultSource(
  row: Row | undefined,
  tab: { connectionId: string; database: string; collection: string },
  shellMode: boolean,
): Row["source"] {
  const source = row?.source;
  if (
    !row?.editable ||
    !source ||
    source.connectionId !== tab.connectionId ||
    !source.database ||
    !source.collection ||
    !source.identity
  )
    return;
  if (
    !shellMode &&
    (source.database !== tab.database || source.collection !== tab.collection)
  )
    return;
  return source;
}

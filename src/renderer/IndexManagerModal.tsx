import { useState } from "react";
import { Layers, Pencil, Trash2 } from "lucide-react";
import { Field, Modal, api, message, useUi } from "./ui";
import type { WorkspaceTab } from "./CollectionTab";

export type IndexSettings = {
  keys: string;
  name: string;
  unique: boolean;
  expireAfterSeconds?: number;
};

function encodedNumber(value: any) {
  if (value && typeof value === "object")
    return value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? "";
  return value;
}

export function IndexManagerModal({
  tab,
  indexes,
  readOnly,
  ensureWritable,
  refreshIndexes,
  close,
  notify,
}: {
  tab: WorkspaceTab;
  indexes: string;
  readOnly: boolean;
  ensureWritable(): boolean;
  refreshIndexes(): Promise<void>;
  close(): void;
  notify(text: string, error?: boolean): void;
}) {
  const { t } = useUi();
  const [indexKeys, setIndexKeys] = useState('{"field":1}');
  const [indexName, setIndexName] = useState("");
  const [unique, setUnique] = useState(false);
  const [ttl, setTtl] = useState("");
  const [editingIndex, setEditingIndex] = useState<string>();
  const [indexDeleteTarget, setIndexDeleteTarget] = useState<{
    name: string;
    keys: string;
  }>();
  const [indexDeleting, setIndexDeleting] = useState(false);
  const [indexRebuildTarget, setIndexRebuildTarget] = useState<
    IndexSettings & { oldName: string; oldKeys: string }
  >();
  const [indexRebuilding, setIndexRebuilding] = useState(false);

  const target = {
    connectionId: tab.connectionId,
    database: tab.database,
    collection: tab.collection,
  };

  const resetIndexEditor = () => {
    setEditingIndex(undefined);
    setIndexKeys('{"field":1}');
    setIndexName("");
    setUnique(false);
    setTtl("");
  };

  const createIndex = async (settings: IndexSettings) => {
    if (!ensureWritable()) return;
    try {
      await api.request("metadata.createIndex", { ...target, ...settings });
      resetIndexEditor();
      await refreshIndexes();
      notify(t("索引已建立", "Index created"));
    } catch (e) {
      notify(message(e), true);
    }
  };

  const deleteIndex = async () => {
    if (!indexDeleteTarget || indexDeleting) return;
    if (!ensureWritable()) return;
    setIndexDeleting(true);
    try {
      await api.request("metadata.dropIndex", {
        ...target,
        name: indexDeleteTarget.name,
      });
      setIndexDeleteTarget(undefined);
      await refreshIndexes();
      notify(t("索引已刪除", "Index deleted"));
    } catch (e) {
      notify(message(e), true);
    } finally {
      setIndexDeleting(false);
    }
  };

  const rebuildIndex = async () => {
    if (!indexRebuildTarget || indexRebuilding) return;
    if (!ensureWritable()) return;
    setIndexRebuilding(true);
    try {
      await api.request("metadata.editIndex", {
        ...target,
        ...indexRebuildTarget,
      });
      setIndexRebuildTarget(undefined);
      resetIndexEditor();
      await refreshIndexes();
      notify(t("索引已重新建立", "Index rebuilt"));
    } catch (e) {
      notify(message(e), true);
    } finally {
      setIndexRebuilding(false);
    }
  };

  return (
    <>
      <Modal
        wide
        title={`${t("索引管理", "Indexes")} · ${tab.collection}`}
        close={close}
      >
        <div className="index-list">
          {JSON.parse(indexes).map((i: any) => (
            <div className="index-row" key={i.name}>
              <Layers size={17} />
              <div>
                <strong>{i.name}</strong>
                <code>{JSON.stringify(i.key)}</code>
              </div>
              <span className="badge">{i.unique ? "UNIQUE" : "INDEX"}</span>
              <button
                className="icon"
                disabled={readOnly || i.name === "_id_"}
                aria-label={`${t("編輯索引", "Edit index")} ${i.name}`}
                title={t("編輯索引", "Edit index")}
                onClick={() => {
                  setEditingIndex(i.name);
                  setIndexKeys(JSON.stringify(i.key));
                  setIndexName(i.name);
                  setUnique(Boolean(i.unique));
                  setTtl(
                    i.expireAfterSeconds === undefined
                      ? ""
                      : String(encodedNumber(i.expireAfterSeconds)),
                  );
                }}
              >
                <Pencil size={15} />
              </button>
              <button
                className="icon"
                disabled={readOnly || i.name === "_id_"}
                aria-label={`${t("刪除索引", "Delete index")} ${i.name}`}
                title={t("刪除索引", "Delete index")}
                onClick={() =>
                  setIndexDeleteTarget({
                    name: i.name,
                    keys: JSON.stringify(i.key),
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <h3>
          {editingIndex
            ? t("編輯索引", "Edit index")
            : t("新增索引", "Create index")}
        </h3>
        <div className="form-grid">
          <Field full label="Keys (JSON)">
            <input
              disabled={readOnly}
              value={indexKeys}
              onChange={(e) => setIndexKeys(e.target.value)}
            />
          </Field>
          <Field label={t("名稱（可省略）", "Name (optional)")}>
            <input
              disabled={readOnly}
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
            />
          </Field>
          <Field label="TTL seconds (optional)">
            <input
              type="number"
              min={0}
              disabled={readOnly}
              value={ttl}
              onChange={(e) => setTtl(e.target.value)}
            />
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={readOnly}
              checked={unique}
              onChange={(e) => setUnique(e.target.checked)}
            />
            Unique
          </label>
          <button
            className="primary"
            disabled={readOnly}
            onClick={async () => {
              const settings: IndexSettings = {
                keys: indexKeys,
                name: indexName,
                unique,
                ...(ttl ? { expireAfterSeconds: Number(ttl) } : {}),
              };
              if (editingIndex) {
                const current = JSON.parse(indexes).find(
                  (index: { name: string; key: unknown }) =>
                    index.name === editingIndex,
                );
                setIndexRebuildTarget({
                  ...settings,
                  oldName: editingIndex,
                  oldKeys: JSON.stringify(current?.key ?? {}),
                });
              } else {
                await createIndex(settings);
              }
            }}
          >
            {editingIndex
              ? t("儲存變更", "Save changes")
              : t("建立", "Create")}
          </button>
        </div>
      </Modal>
      {indexDeleteTarget && (
        <Modal
          title={t("刪除索引", "Delete index")}
          close={() => {
            if (!indexDeleting) setIndexDeleteTarget(undefined);
          }}
          footer={
            <>
              <button
                disabled={indexDeleting}
                onClick={() => setIndexDeleteTarget(undefined)}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                className="danger"
                disabled={indexDeleting}
                onClick={() => void deleteIndex()}
              >
                {indexDeleting
                  ? t("刪除中…", "Deleting…")
                  : t("刪除索引", "Delete index")}
              </button>
            </>
          }
        >
          <p>
            {t(
              "這會移除索引，後續查詢可能變慢。請確認目標後再繼續。",
              "This removes the index and can slow later queries. Confirm the target before continuing.",
            )}
          </p>
          <dl className="confirmation-details">
            <div>
              <dt>{t("連線", "Connection")}</dt>
              <dd>{tab.connectionName}</dd>
            </div>
            <div>
              <dt>{t("Collection", "Collection")}</dt>
              <dd>
                {tab.database}.{tab.collection}
              </dd>
            </div>
            <div>
              <dt>{t("索引", "Index")}</dt>
              <dd>{indexDeleteTarget.name}</dd>
            </div>
            <div>
              <dt>{t("欄位", "Keys")}</dt>
              <dd>
                <code>{indexDeleteTarget.keys}</code>
              </dd>
            </div>
          </dl>
        </Modal>
      )}
      {indexRebuildTarget && (
        <Modal
          title={t("重新建立索引", "Rebuild index")}
          close={() => {
            if (!indexRebuilding) setIndexRebuildTarget(undefined);
          }}
          footer={
            <>
              <button
                disabled={indexRebuilding}
                onClick={() => setIndexRebuildTarget(undefined)}
              >
                {t("取消", "Cancel")}
              </button>
              <button
                className="danger"
                disabled={indexRebuilding}
                onClick={() => void rebuildIndex()}
              >
                {indexRebuilding
                  ? t("重新建立中…", "Rebuilding…")
                  : t("重新建立索引", "Rebuild index")}
              </button>
            </>
          }
        >
          <p>
            {t(
              "更新索引會先刪除既有索引，再以新設定建立。這段期間查詢可能變慢。",
              "Updating an index deletes the current index before creating the new one. Queries can be slower during that interval.",
            )}
          </p>
          <dl className="confirmation-details">
            <div>
              <dt>{t("連線", "Connection")}</dt>
              <dd>{tab.connectionName}</dd>
            </div>
            <div>
              <dt>{t("Collection", "Collection")}</dt>
              <dd>
                {tab.database}.{tab.collection}
              </dd>
            </div>
            <div>
              <dt>{t("原索引", "Current index")}</dt>
              <dd>
                <code>
                  {indexRebuildTarget.oldName} {indexRebuildTarget.oldKeys}
                </code>
              </dd>
            </div>
            <div>
              <dt>{t("新欄位", "New keys")}</dt>
              <dd>
                <code>{indexRebuildTarget.keys}</code>
              </dd>
            </div>
          </dl>
        </Modal>
      )}
    </>
  );
}

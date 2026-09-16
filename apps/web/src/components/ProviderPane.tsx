import { useEffect, useState } from "react";
import {
  CANONICAL_ENV,
  deleteProvider,
  fetchBackups,
  fetchProviders,
  previewImport,
  providersFor,
  rollbackTo,
  runImport,
  saveProvider,
  switchProvider,
  type AppId,
  type AppStatus,
  type BackupEntry,
  type ImportCandidate,
  type ProviderPayload,
  type ProviderView,
} from "../agentProviders";
import { useI18n } from "../i18n";
import { textInputProps } from "../textInputProps";
import { BackIcon, CheckIcon, EditIcon, HistoryIcon, PlusIcon, ProviderIcon, SpinnerIcon, TrashIcon } from "./icons";

/** Local edit state. Canonical fields map onto each app's own env names. */
interface Draft {
  id: string;
  appId: AppId;
  name: string;
  category: ProviderView["category"];
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Codex only — the [model_providers.x] section name and wire format. */
  sectionId: string;
  wireApi: string;
  /** Keys the form has no field for, kept so an import never loses them. */
  extraEnv: Array<{ name: string; value: string }>;
  sectionExtras: Record<string, string | number | boolean>;
  isNew: boolean;
  hasStoredKey: boolean;
}

const newId = () => crypto.randomUUID();

function toDraft(appId: AppId, provider?: ProviderView): Draft {
  const canonical = CANONICAL_ENV[appId];
  const env = { ...(provider?.env ?? {}) };
  const take = (name?: string) => {
    if (!name) return "";
    const value = env[name] ?? "";
    delete env[name];
    return value;
  };
  const section = { ...(provider?.codex?.section ?? {}) };
  const baseUrl = appId === "codex" ? String(section.base_url ?? "") : take(canonical.baseUrl);
  const wireApi = String(section.wire_api ?? "chat");
  delete section.base_url;
  delete section.wire_api;
  delete section.name;
  return {
    id: provider?.id ?? newId(),
    appId,
    name: provider?.name ?? "",
    category: provider?.category ?? "custom",
    baseUrl,
    apiKey: take(canonical.apiKey),
    model:
      appId === "codex"
        ? String(provider?.codex?.topLevel?.model ?? "")
        : take(canonical.model),
    sectionId: provider?.codex?.sectionId ?? "",
    wireApi,
    extraEnv: Object.entries(env).map(([name, value]) => ({ name, value })),
    sectionExtras: section,
    isNew: !provider,
    hasStoredKey: Boolean(provider?.secretEnv.length),
  };
}

function fromDraft(draft: Draft): Partial<ProviderView> {
  const canonical = CANONICAL_ENV[draft.appId];
  const env: Record<string, string> = {};
  for (const { name, value } of draft.extraEnv) {
    if (name.trim()) env[name.trim()] = value;
  }
  if (canonical.baseUrl && draft.baseUrl.trim()) env[canonical.baseUrl] = draft.baseUrl.trim();
  if (canonical.apiKey && draft.apiKey.trim()) env[canonical.apiKey] = draft.apiKey.trim();
  if (canonical.model && draft.model.trim()) env[canonical.model] = draft.model.trim();

  const base: Partial<ProviderView> = {
    id: draft.id,
    appId: draft.appId,
    name: draft.name.trim() || "Provider",
    category: draft.category,
    env,
  };
  if (draft.appId !== "codex") return base;

  // An official Codex login has no custom provider section at all — that is
  // what clears `model_provider` instead of pointing it somewhere empty.
  const sectionId = draft.sectionId.trim() || draft.baseUrl.trim().replace(/^https?:\/\//, "").split(/[./]/)[0];
  if (!draft.baseUrl.trim() || !sectionId) return { ...base, codex: null };
  return {
    ...base,
    codex: {
      sectionId,
      section: {
        ...draft.sectionExtras,
        name: draft.name.trim() || sectionId,
        base_url: draft.baseUrl.trim(),
        wire_api: draft.wireApi || "chat",
      },
      ...(draft.model.trim() ? { topLevel: { model: draft.model.trim() } } : {}),
    },
  };
}

/**
 * Model providers for the agent CLIs installed on this machine — a pane view,
 * like Agent usage and Session history, so it splits, tiles and stays open
 * alongside the terminal it is being configured for.
 */
export function ProviderPane() {
  const { t } = useI18n();
  const [payload, setPayload] = useState<ProviderPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [backups, setBackups] = useState<{ appId: AppId; entries: BackupEntry[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProviderView | null>(null);

  const run = async (key: string, action: () => Promise<ProviderPayload | void>) => {
    setBusy(key);
    setError("");
    try {
      const next = await action();
      if (next) setPayload(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    fetchProviders()
      .then(setPayload)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // Escape leaves a sub-view. Closing the pane itself belongs to the pane
  // header, the same as every other view.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (draft) setDraft(null);
      else if (candidates) setCandidates(null);
      else if (backups) setBackups(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [backups, candidates, draft]);

  const header = (title: string, back?: () => void) => (
    <div className="provider-pane-header">
      {back && (
        <button className="provider-icon-btn" onClick={back} title={t("providers.back")}>
          <BackIcon />
        </button>
      )}
      <span className="provider-pane-title">
        {!back && <ProviderIcon />}
        <span>{title}</span>
      </span>
    </div>
  );

  if (draft) {
    return (
      <div className="provider-pane">
        {header(draft.isNew ? t("providers.addTitle") : t("providers.editTitle"), () => setDraft(null))}
        <ProviderForm
          draft={draft}
          onChange={setDraft}
          busy={busy === "save"}
          onCancel={() => setDraft(null)}
          onSave={() =>
            run("save", async () => {
              const next = await saveProvider(fromDraft(draft));
              setDraft(null);
              return next;
            })
          }
        />
        {error && <div className="provider-error">{error}</div>}
      </div>
    );
  }

  if (candidates) {
    return (
      <div className="provider-pane">
        {header(t("providers.importTitle"), () => setCandidates(null))}
        <div className="provider-pane-body single">
          {candidates.length === 0 && <div className="provider-empty">{t("providers.importEmpty")}</div>}
          {candidates.map((entry) => (
            <div key={entry.id} className="provider-import-row">
              <div className="provider-import-main">
                <span className="provider-name">{entry.name}</span>
                <span className="provider-chip">{entry.appId}</span>
                {entry.wasCurrent && <span className="provider-chip active">{t("providers.wasCurrent")}</span>}
                {entry.existing && <span className="provider-chip">{t("providers.willReplace")}</span>}
              </div>
              <div className="provider-import-detail">
                {entry.codexSection ? `model_providers.${entry.codexSection}` : entry.envNames.join(", ") || "—"}
              </div>
            </div>
          ))}
        </div>
        <div className="provider-pane-footer">
          <span className="provider-hint">{t("providers.importHint")}</span>
          <button
            className="provider-primary-btn"
            disabled={busy === "import" || candidates.length === 0}
            onClick={() =>
              run("import", async () => {
                const next = await runImport();
                setCandidates(null);
                return next;
              })
            }
          >
            {busy === "import" ? <SpinnerIcon /> : t("providers.importConfirm", { n: candidates.length })}
          </button>
        </div>
        {error && <div className="provider-error">{error}</div>}
      </div>
    );
  }

  if (backups) {
    return (
      <div className="provider-pane">
        {header(t("providers.backupsTitle"), () => setBackups(null))}
        <div className="provider-pane-body single">
          {backups.entries.length === 0 && <div className="provider-empty">{t("providers.backupsEmpty")}</div>}
          {backups.entries.map((entry) => (
            <div key={entry.id} className="provider-row">
              <div className="provider-row-main">
                <span className="provider-name">{new Date(entry.at).toLocaleString()}</span>
                <span className="provider-row-detail">{entry.providerName}</span>
              </div>
              <button
                className="provider-text-btn"
                disabled={busy === entry.id}
                onClick={() =>
                  run(entry.id, async () => {
                    const next = await rollbackTo(backups.appId, entry.id);
                    setBackups(null);
                    return next;
                  })
                }
              >
                {busy === entry.id ? <SpinnerIcon /> : t("providers.restore")}
              </button>
            </div>
          ))}
        </div>
        {error && <div className="provider-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="provider-pane">
      {header(t("providers.title"))}
      <div className="provider-pane-body">
        {!payload && !error && <div className="provider-empty"><SpinnerIcon /></div>}
        <div className="provider-apps">
        {payload?.apps.map((app) => (
          <AppSection
            key={app.appId}
            app={app}
            providers={providersFor(payload, app.appId)}
            busy={busy}
            onSwitch={(providerId) => run(`switch:${app.appId}`, () => switchProvider(app.appId, providerId))}
            onAdd={() => setDraft(toDraft(app.appId))}
            onEdit={(provider) => setDraft(toDraft(app.appId, provider))}
            onDelete={setConfirmDelete}
            onBackups={() =>
              run(`backups:${app.appId}`, async () => {
                const { backups: entries } = await fetchBackups(app.appId);
                setBackups({ appId: app.appId, entries });
              })
            }
          />
        ))}
        </div>
      </div>
      <div className="provider-pane-footer">
        {payload?.ccSwitchAvailable ? (
          <button
            className="provider-text-btn"
            disabled={busy === "preview"}
            onClick={() =>
              run("preview", async () => {
                const preview = await previewImport();
                if (preview.error) throw new Error(preview.error);
                setCandidates(preview.providers);
              })
            }
          >
            {busy === "preview" ? <SpinnerIcon /> : t("providers.importCcSwitch")}
          </button>
        ) : (
          <span className="provider-hint">{t("providers.footerHint")}</span>
        )}
      </div>
      {confirmDelete && (
        <div className="provider-confirm">
          <span>{t("providers.deleteConfirm", { name: confirmDelete.name })}</span>
          <div className="provider-confirm-actions">
            <button className="provider-text-btn" onClick={() => setConfirmDelete(null)}>
              {t("providers.cancel")}
            </button>
            <button
              className="provider-danger-btn"
              onClick={() =>
                run("delete", async () => {
                  const next = await deleteProvider(confirmDelete.id);
                  setConfirmDelete(null);
                  return next;
                })
              }
            >
              {t("providers.delete")}
            </button>
          </div>
        </div>
      )}
      {error && <div className="provider-error">{error}</div>}
    </div>
  );
}

function AppSection({
  app,
  providers,
  busy,
  onSwitch,
  onAdd,
  onEdit,
  onDelete,
  onBackups,
}: {
  app: AppStatus;
  providers: ProviderView[];
  busy: string | null;
  onSwitch: (providerId: string | null) => void;
  onAdd: () => void;
  onEdit: (provider: ProviderView) => void;
  onDelete: (provider: ProviderView) => void;
  onBackups: () => void;
}) {
  const { t } = useI18n();
  const switching = busy === `switch:${app.appId}`;
  return (
    <section className="provider-app">
      <div className="provider-app-header">
        <span className="provider-app-label">{app.label}</span>
        {!app.verified && <span className="provider-chip warn">{t("providers.unverified")}</span>}
        {app.drifted && <span className="provider-chip warn">{t("providers.drifted")}</span>}
        <button className="provider-icon-btn" title={t("providers.backupsTitle")} onClick={onBackups}>
          <HistoryIcon />
        </button>
      </div>
      <button
        className={`provider-row selectable ${app.currentProviderId === null ? "active" : ""}`}
        disabled={switching}
        onClick={() => onSwitch(null)}
      >
        <span className="provider-check">{app.currentProviderId === null && <CheckIcon />}</span>
        <span className="provider-row-main">
          <span className="provider-name">{t("providers.none")}</span>
          <span className="provider-row-detail">{t("providers.noneDetail")}</span>
        </span>
      </button>
      {providers.map((provider) => {
        const active = app.currentProviderId === provider.id;
        return (
          <div key={provider.id} className={`provider-row selectable ${active ? "active" : ""}`}>
            <button className="provider-row-select" disabled={switching} onClick={() => onSwitch(provider.id)}>
              <span className="provider-check">{active && <CheckIcon />}</span>
              <span className="provider-row-main">
                <span className="provider-name">{provider.name}</span>
                <span className="provider-row-detail">
                  {provider.appId === "codex"
                    ? String(provider.codex?.section.base_url ?? t("providers.officialLogin"))
                    : provider.env[CANONICAL_ENV[provider.appId].baseUrl ?? ""] || t("providers.officialLogin")}
                </span>
              </span>
            </button>
            <button className="provider-icon-btn" title={t("providers.edit")} onClick={() => onEdit(provider)}>
              <EditIcon />
            </button>
            <button className="provider-icon-btn" title={t("providers.delete")} onClick={() => onDelete(provider)}>
              <TrashIcon />
            </button>
          </div>
        );
      })}
      <button className="provider-add" onClick={onAdd}>
        <PlusIcon />
        <span>{t("providers.add")}</span>
      </button>
      {app.note && <div className="provider-app-note">{app.note}</div>}
    </section>
  );
}

function ProviderForm({
  draft,
  onChange,
  busy,
  onSave,
  onCancel,
}: {
  draft: Draft;
  onChange: (draft: Draft) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const canonical = CANONICAL_ENV[draft.appId];
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <>
      <div className="provider-pane-body single">
        <label className="provider-field">
          <span>{t("providers.name")}</span>
          <input {...textInputProps} value={draft.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="provider-field">
          <span>{t("providers.baseUrl")}</span>
          <input
            {...textInputProps}
            placeholder={t("providers.baseUrlPlaceholder")}
            value={draft.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </label>
        {canonical.apiKey && (
          <label className="provider-field">
            <span>{canonical.apiKey}</span>
            <input
              {...textInputProps}
              type="password"
              placeholder={draft.hasStoredKey ? t("providers.keyUnchanged") : ""}
              value={draft.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
            />
          </label>
        )}
        <label className="provider-field">
          <span>{t("providers.model")}</span>
          <input {...textInputProps} value={draft.model} onChange={(e) => set({ model: e.target.value })} />
        </label>
        {draft.appId === "codex" && (
          <>
            <label className="provider-field">
              <span>{t("providers.sectionId")}</span>
              <input
                {...textInputProps}
                placeholder={t("providers.sectionIdPlaceholder")}
                value={draft.sectionId}
                onChange={(e) => set({ sectionId: e.target.value })}
              />
            </label>
            <label className="provider-field">
              <span>{t("providers.wireApi")}</span>
              <select value={draft.wireApi} onChange={(e) => set({ wireApi: e.target.value })}>
                <option value="chat">chat</option>
                <option value="responses">responses</option>
              </select>
            </label>
          </>
        )}
        {draft.extraEnv.length > 0 && (
          <div className="provider-extra">
            <div className="provider-extra-title">{t("providers.extraEnv")}</div>
            {draft.extraEnv.map((entry, index) => (
              <div key={`${entry.name}-${index}`} className="provider-extra-row">
                <input
                  {...textInputProps}
                  value={entry.name}
                  onChange={(e) =>
                    set({
                      extraEnv: draft.extraEnv.map((item, i) =>
                        i === index ? { ...item, name: e.target.value } : item
                      ),
                    })
                  }
                />
                <input
                  {...textInputProps}
                  value={entry.value}
                  onChange={(e) =>
                    set({
                      extraEnv: draft.extraEnv.map((item, i) =>
                        i === index ? { ...item, value: e.target.value } : item
                      ),
                    })
                  }
                />
                <button
                  className="provider-icon-btn"
                  onClick={() => set({ extraEnv: draft.extraEnv.filter((_, i) => i !== index) })}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          className="provider-text-btn provider-extra-add"
          onClick={() => set({ extraEnv: [...draft.extraEnv, { name: "", value: "" }] })}
        >
          <PlusIcon />
          <span>{t("providers.addEnv")}</span>
        </button>
      </div>
      <div className="provider-pane-footer">
        <button className="provider-text-btn" onClick={onCancel}>
          {t("providers.cancel")}
        </button>
        <button className="provider-primary-btn" disabled={busy} onClick={onSave}>
          {busy ? <SpinnerIcon /> : t("providers.save")}
        </button>
      </div>
    </>
  );
}

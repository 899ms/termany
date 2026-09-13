import { Fragment, useState } from "react";
import { agentLauncherSection, sortAgentLauncherRecipients } from "../agentLauncherOrder";
import { useI18n } from "../i18n";
import { useImeGuard } from "../imeGuard";
import { textInputProps } from "../textInputProps";
import { AgentAvatar } from "./AgentIdentityFields";
import type { AgentLauncherRecipient } from "./AgentLauncher";
import { CheckIcon, ChevronIcon, CloseIcon, SearchIcon } from "./icons";

export function AgentGroupDialog({ bots, initialName = "", initialMembers = [], editing = false, onSave, onBack, onClose, onNewBot }: {
  bots: AgentLauncherRecipient[];
  initialName?: string;
  initialMembers?: string[];
  editing?: boolean;
  onSave: (name: string, memberIds: string[]) => void;
  onBack: () => void;
  onClose: () => void;
  onNewBot: () => void;
}) {
  const { t } = useI18n();
  const ime = useImeGuard();
  const [name, setName] = useState(initialName);
  const [selected, setSelected] = useState(initialMembers.filter((id) => bots.some((bot) => bot.id === id)));
  const [query, setQuery] = useState("");
  const matching = sortAgentLauncherRecipients(
    bots.filter((bot) => bot.title.toLowerCase().includes(query.trim().toLowerCase()))
  );
  const title = t(editing ? "agentGroup.editMembers" : "agentWorkspace.newGroup");
  return (
    <form className="agent-dialog agent-create-dialog agent-group-dialog" autoComplete="off"
      role="dialog" aria-modal="true" aria-label={title}
      onSubmit={(event) => { event.preventDefault(); if (name.trim() && selected.length >= 2) onSave(name.trim(), selected); }}
      onKeyDown={(event) => {
        if (ime.handled(event)) { if (event.key === "Enter") event.preventDefault(); return; }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onBack(); }
      }}
    >
      <header className="agent-dialog-head">
        <button type="button" aria-label={t("common.cancel")} onClick={onBack}><ChevronIcon dir="left" /></button>
        <strong>{title}</strong>
        <button type="button" aria-label={t("common.close")} onClick={onClose}><CloseIcon /></button>
      </header>
      <div className="agent-create-content">
        {!editing && <label className="agent-create-name">
          <span>{t("agentGroup.name")}</span>
          <input {...textInputProps} {...ime.props} autoFocus value={name}
            placeholder={t("agentWorkspace.newGroup")} onChange={(event) => setName(event.target.value)} />
        </label>}
        <fieldset className="agent-runtime-fieldset">
          <legend>{t("agentGroup.members")}</legend>
          <label className="agent-group-search">
            <SearchIcon />
            <input {...textInputProps} {...ime.props} autoFocus={editing} value={query}
              aria-label={t("agentWorkspace.search")} placeholder={t("agentWorkspace.search")}
              onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="agent-group-options">
            {matching.map((bot, index) => {
              const section = agentLauncherSection(bot.title);
              const previous = index > 0 ? agentLauncherSection(matching[index - 1].title) : "";
              return <Fragment key={bot.id}>
                {section !== previous && <div className="agent-launcher-letter" role="presentation" aria-hidden="true">{section}</div>}
                <button type="button" role="checkbox"
                  aria-checked={selected.includes(bot.id)}
                  className={`agent-launcher-option ${selected.includes(bot.id) ? "selected" : ""}`}
                  onClick={() => setSelected((ids) => ids.includes(bot.id) ? ids.filter((id) => id !== bot.id) : [...ids, bot.id])}
                >
                  <AgentAvatar avatar={bot.avatar} icon={bot.icon} className="agent-launcher-avatar" />
                  <span className="agent-launcher-label">{bot.title}</span>
                  <span className="agent-group-check" aria-hidden="true">{selected.includes(bot.id) && <CheckIcon />}</span>
                </button>
              </Fragment>;
            })}
            {matching.length === 0 && <div className="agent-launcher-empty">
              {query.trim() ? t("history.noMatch", { query: query.trim() }) : t("agentWorkspace.noBots")}
            </div>}
          </div>
          {bots.length < 2 && <button type="button" className="agent-group-new-bot" onClick={onNewBot}>{t("agentWorkspace.createBot")}</button>}
        </fieldset>
      </div>
      <div className="agent-create-actions">
        <span className="agent-group-selection-count">{t(selected.length < 2 ? "agentGroup.selectMembers" : "agentGroup.selected", { n: selected.length })}</span>
        <button type="button" className="agent-create-cancel" onClick={onBack}>{t("common.cancel")}</button>
        <button type="submit" className="agent-create-submit" disabled={!name.trim() || selected.length < 2}>
          {t(editing ? "common.done" : "workspace.create")}
        </button>
      </div>
    </form>
  );
}

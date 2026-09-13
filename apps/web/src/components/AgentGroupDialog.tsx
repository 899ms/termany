import { Fragment, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { agentLauncherSection, sortAgentLauncherRecipients } from "../agentLauncherOrder";
import { useI18n } from "../i18n";
import { useImeGuard } from "../imeGuard";
import { textInputProps } from "../textInputProps";
import { AgentAvatar } from "./AgentIdentityFields";
import type { AgentLauncherRecipient } from "./AgentLauncher";
import { CheckIcon, ChevronIcon, CloseIcon, GroupChatIcon, SearchIcon } from "./icons";

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
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberMenuPosition, setMemberMenuPosition] = useState<{
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const memberSelectorRef = useRef<HTMLDivElement>(null);
  const memberMenuRef = useRef<HTMLDivElement>(null);
  const groupNameInputRef = useRef<HTMLInputElement>(null);
  const memberMenuId = useId();
  const matching = sortAgentLauncherRecipients(
    bots.filter((bot) => bot.title.toLowerCase().includes(query.trim().toLowerCase()))
  );
  const matchingIds = matching.map((bot) => bot.id);
  const allMatchingSelected = matchingIds.length > 0 && matchingIds.every((id) => selected.includes(id));
  const filtered = Boolean(query.trim());
  const bulkSelectionLabel = t(filtered
    ? allMatchingSelected ? "agentGroup.deselectResults" : "agentGroup.selectResults"
    : allMatchingSelected ? "agentGroup.deselectAll" : "agentGroup.selectAll");
  const toggleMatching = () => setSelected((ids) => {
    const visible = new Set(matchingIds);
    if (allMatchingSelected) return ids.filter((id) => !visible.has(id));
    return [...ids, ...matchingIds.filter((id) => !ids.includes(id))];
  });
  const selectedBots = selected.flatMap((id) => {
    const bot = bots.find((candidate) => candidate.id === id);
    return bot ? [bot] : [];
  });
  const closeMembers = () => {
    setMembersOpen(false);
    setQuery("");
    if (!editing) requestAnimationFrame(() => groupNameInputRef.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    if (!membersOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!memberSelectorRef.current?.contains(target) && !memberMenuRef.current?.contains(target)) closeMembers();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMembers();
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [membersOpen]);

  useEffect(() => {
    if (!membersOpen) {
      setMemberMenuPosition(null);
      return;
    }
    const positionMenu = () => {
      const rect = memberSelectorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const edge = 12;
      const gap = 6;
      const desiredHeight = Math.min(420, bots.length * 44 + 112);
      const availableBelow = window.innerHeight - rect.bottom - edge - gap;
      const availableAbove = rect.top - edge - gap;
      const openAbove = availableBelow < Math.min(desiredHeight, 220) && availableAbove > availableBelow;
      const available = openAbove ? availableAbove : availableBelow;
      const maxHeight = Math.max(180, Math.min(desiredHeight, available));
      setMemberMenuPosition({
        left: Math.max(edge, Math.min(rect.left, window.innerWidth - rect.width - edge)),
        top: openAbove ? rect.top - gap - maxHeight : rect.bottom + gap,
        width: Math.min(rect.width, window.innerWidth - edge * 2),
        maxHeight,
      });
    };
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [bots.length, membersOpen]);
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
          <input {...textInputProps} {...ime.props} ref={groupNameInputRef} autoFocus value={name}
            placeholder={t("agentWorkspace.newGroup")} onChange={(event) => setName(event.target.value)} />
        </label>}
        <fieldset className="agent-runtime-fieldset">
          <legend>{t("agentGroup.members")}</legend>
          <div className="agent-member-selector" ref={memberSelectorRef}>
            <button type="button" className={`agent-member-selector-trigger ${membersOpen ? "open" : ""}`}
              aria-haspopup="dialog" aria-expanded={membersOpen} aria-controls={memberMenuId}
              onClick={() => membersOpen ? closeMembers() : setMembersOpen(true)}>
              <span className="agent-member-selector-avatars" aria-hidden="true">
                {selectedBots.length ? selectedBots.slice(0, 3).map((bot) => (
                  <AgentAvatar key={bot.id} avatar={bot.avatar} icon={bot.icon} className="agent-launcher-avatar" />
                )) : <span className="agent-member-selector-placeholder"><GroupChatIcon /></span>}
                {selectedBots.length > 3 && <span className="agent-member-selector-more">+{selectedBots.length - 3}</span>}
              </span>
              <span>{t(selected.length < 2 ? "agentGroup.selectMembers" : "agentGroup.selected", { n: selected.length })}</span>
              <ChevronIcon dir="down" />
            </button>
          </div>
          {membersOpen && memberMenuPosition && createPortal(
            <div id={memberMenuId} ref={memberMenuRef} className="agent-member-selector-menu"
              role="dialog" aria-label={t("agentGroup.members")} style={memberMenuPosition}>
              <label className="agent-group-search">
                <SearchIcon />
                <input {...textInputProps} {...ime.props} autoFocus value={query}
                  aria-label={t("agentWorkspace.search")} placeholder={t("agentWorkspace.search")}
                  onChange={(event) => setQuery(event.target.value)} />
              </label>
              <div className="agent-member-selector-toolbar">
                <span>{t(selected.length < 2 ? "agentGroup.selectMembers" : "agentGroup.selected", { n: selected.length })}</span>
                {matching.length > 0 && <button type="button" className="agent-group-bulk-action"
                  onClick={toggleMatching}>{bulkSelectionLabel}</button>}
              </div>
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
              {bots.length < 2 && <button type="button" className="agent-group-new-bot"
                onClick={onNewBot}>{t("agentWorkspace.createBot")}</button>}
            </div>,
            document.body
          )}
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

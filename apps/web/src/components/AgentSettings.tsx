import { textInputProps } from "../textInputProps";
import { defaultAgentRuntime } from "@termany/core";
import { useEffect, useRef, useState } from "react";
import {
  agentCommand,
  createCustomAgent,
  detectAgentConfigs,
  loadAgentConfigs,
  saveAgentConfigs,
  syncAgentConfigs,
  type AgentConfig,
  type AgentRuntimeConfig,
} from "../agents";
import { useI18n } from "../i18n";
import { AgentIcon, ChevronIcon, CloseIcon, PlusIcon, RefreshIcon } from "./icons";

function AgentAvatar({ agent }: { agent: AgentConfig }) {
  return agent.icon ? (
    <img className="agent-settings-icon" src={agent.icon} alt="" aria-hidden="true" />
  ) : (
    <span className="agent-settings-icon fallback" aria-hidden="true">
      <AgentIcon />
    </span>
  );
}

export function AgentSettings({ initialAgentId }: { initialAgentId?: string }) {
  const { t } = useI18n();
  const [agents, setAgents] = useState(loadAgentConfigs);
  const [expanded, setExpanded] = useState<string | null>(initialAgentId ?? null);
  const initialAgentRef = useRef<HTMLDivElement>(null);
  const [detecting, setDetecting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const commit = (next: AgentConfig[]) => {
    setAgents(next);
    saveAgentConfigs(next);
  };

  const updateAgent = (id: string, patch: Partial<AgentConfig>) => {
    commit(agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)));
  };

  const updateRuntime = (agent: AgentConfig, patch: Record<string, unknown>) => {
    if (!agent.runtime) return;
    updateAgent(agent.id, { runtime: { ...agent.runtime, ...patch } as AgentRuntimeConfig });
  };

  const toggleRuntime = (agent: AgentConfig, enabled: boolean) => {
    updateAgent(agent.id, {
      runtime: enabled
        ? agent.runtime ?? (agent.builtIn ? defaultAgentRuntime(agent.id) : undefined) ?? {
            protocol: "acp",
            command: agent.command,
            args: "acp",
            distribution: "system",
            modelSource: "agent",
          }
        : undefined,
    });
  };

  const detect = async (source = agents) => {
    setDetecting(true);
    setStatus(null);
    try {
      const next = await detectAgentConfigs(source);
      setAgents(next);
      saveAgentConfigs(next);
    } catch (e) {
      setStatus(`${t("agents.detectFailed")}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    void syncAgentConfigs()
      .then((next) => detect(next))
      .catch(() => detect(loadAgentConfigs()));
    // Detect once when the settings section opens; manual refresh stays explicit after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialAgentId) return;
    initialAgentRef.current?.scrollIntoView({ block: "nearest" });
  }, [initialAgentId]);

  const addCustom = () => {
    const agent = createCustomAgent();
    const next = [agent, ...agents];
    commit(next);
    setExpanded(agent.id);
  };

  const removeCustom = (id: string) => {
    const next = agents.filter((agent) => agent.id !== id);
    commit(next);
    if (expanded === id) setExpanded(next[0]?.id ?? null);
  };

  return (
    <div className="agent-settings">
      <div className="agent-settings-head">
        <div className="settings-section-title">{t("agents.title")}</div>
        <div className="agent-settings-head-actions">
          <button className="agent-refresh-btn" onClick={addCustom}>
            <PlusIcon />
            {t("agents.add")}
          </button>
          <button className="agent-refresh-btn" onClick={() => detect()} disabled={detecting}>
            <RefreshIcon />
            {detecting ? "..." : t("agents.refresh")}
          </button>
        </div>
      </div>
      {status && <div className="agent-settings-status">{status}</div>}

      <div className="agent-settings-list">
        {agents.map((agent) => {
          const isExpanded = expanded === agent.id;
          return (
            <div
              key={agent.id}
              ref={agent.id === initialAgentId ? initialAgentRef : undefined}
              className="agent-settings-row"
            >
              <div className="agent-settings-main">
                <AgentAvatar agent={agent} />
                <div className="agent-settings-meta">
                  <div className="agent-settings-name">{agent.name}</div>
                  <div className="agent-settings-command" title={agent.detectedPath ?? agentCommand(agent)}>
                    {agentCommand(agent) || t("agents.commandMissing")}
                  </div>
                </div>

                <div className="agent-settings-actions">
                  <div className="agent-enable-toggle" aria-label={`${agent.name} enabled state`}>
                    <button
                      className={agent.enabled ? "active" : ""}
                      onClick={() => updateAgent(agent.id, { enabled: true })}
                    >
                      {t("agents.enabled")}
                    </button>
                    <button
                      className={!agent.enabled ? "active" : ""}
                      onClick={() => updateAgent(agent.id, { enabled: false })}
                    >
                      {t("agents.disabled")}
                    </button>
                  </div>
                  <button
                    className="agent-expand-btn"
                    title={isExpanded ? "Collapse" : "Expand"}
                    onClick={() => setExpanded(isExpanded ? null : agent.id)}
                  >
                    <ChevronIcon dir={isExpanded ? "up" : "down"} />
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="agent-settings-edit">
                  <label className="agent-field">
                    <span>{t("agents.name")}</span>
                    <input
                      {...textInputProps}
                      value={agent.name}
                      onChange={(e) => updateAgent(agent.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="agent-field">
                    <span>{t("agents.command")}</span>
                    <input
                      {...textInputProps}
                      value={agent.command}
                      onChange={(e) => updateAgent(agent.id, { command: e.target.value })}
                    />
                  </label>
                  <label className="agent-field">
                    <span>{t("agents.args")}</span>
                    <input
                      {...textInputProps}
                      value={agent.args}
                      onChange={(e) => updateAgent(agent.id, { args: e.target.value })}
                    />
                  </label>
                  <label className="agent-field agent-runtime-toggle">
                    <span>{t("agents.runtime")}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(agent.runtime)}
                      onChange={(event) => toggleRuntime(agent, event.target.checked)}
                    />
                  </label>
                  {agent.runtime && (
                    <div className="agent-runtime-fields">
                      <label className="agent-field">
                        <span>{t("agents.runtimeProtocol")}</span>
                        <select value={agent.runtime.protocol} disabled>
                          <option value="acp">Agent Client Protocol (stdio)</option>
                          <option value="acp-http">Agent Communication Protocol 0.2 (HTTP)</option>
                        </select>
                      </label>
                      {agent.runtime.protocol === "acp-http" ? (
                        <>
                          <label className="agent-field">
                            <span>ACP endpoint</span>
                            <input
                              {...textInputProps}
                              value={agent.runtime.endpoint}
                              placeholder="http://127.0.0.1:18953/acp"
                              onChange={(event) => updateRuntime(agent, { endpoint: event.target.value })}
                            />
                          </label>
                          <label className="agent-field">
                            <span>{t("models.form.apiKey")}</span>
                            <input
                              {...textInputProps}
                              type="password"
                              value={agent.runtime.apiKey}
                              placeholder="FASTCLAW_API_KEY"
                              autoComplete="off"
                              onChange={(event) => updateRuntime(agent, { apiKey: event.target.value })}
                            />
                          </label>
                        </>
                      ) : (
                        <>
                          <label className="agent-field">
                            <span>{t("agents.runtimeCommand")}</span>
                            <input
                              {...textInputProps}
                              value={agent.runtime.command}
                              onChange={(event) => updateRuntime(agent, { command: event.target.value })}
                            />
                          </label>
                          <label className="agent-field">
                            <span>{t("agents.runtimeArgs")}</span>
                            <input
                              {...textInputProps}
                              value={agent.runtime.args}
                              onChange={(event) => updateRuntime(agent, { args: event.target.value })}
                            />
                          </label>
                          <label className="agent-field">
                            <span>{t("agents.runtimeDistribution")}</span>
                            <select
                              value={agent.runtime.distribution}
                              onChange={(event) => updateRuntime(agent, { distribution: event.target.value })}
                            >
                              <option value="system">{t("agents.runtimeSystem")}</option>
                              <option value="managed" disabled>{t("agents.runtimeManaged")}</option>
                              <option value="custom">{t("agents.runtimeCustom")}</option>
                            </select>
                          </label>
                          <label className="agent-field">
                            <span>{t("agents.runtimeModels")}</span>
                            <select
                              value={agent.runtime.modelSource}
                              onChange={(event) => updateRuntime(agent, { modelSource: event.target.value })}
                            >
                              <option value="agent">{t("agents.runtimeModelsAgent")}</option>
                              <option value="termany" disabled>{t("agents.runtimeModelsTermany")}</option>
                            </select>
                          </label>
                        </>
                      )}
                    </div>
                  )}
                  {!agent.builtIn && (
                    <label className="agent-field">
                      <span>{t("agents.iconUrl")}</span>
                      <input
                        {...textInputProps}
                        value={agent.icon ?? ""}
                        onChange={(e) => updateAgent(agent.id, { icon: e.target.value })}
                      />
                    </label>
                  )}
                  <div className="agent-settings-edit-foot">
                    <div className="agent-settings-help">{t("agents.help")}</div>
                    {!agent.builtIn && (
                      <button className="agent-remove-btn" onClick={() => removeCustom(agent.id)}>
                        <CloseIcon />
                        {t("agents.remove")}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

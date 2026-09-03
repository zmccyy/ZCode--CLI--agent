// MCP 命令处理 - 闭环 9-11

import React, { useEffect, useRef } from 'react';
import { MCPSettings } from '../../components/mcp/index.js';
import { MCPReconnect } from '../../components/mcp/MCPReconnect.js';
import { useMcpToggleEnabled } from '../../services/mcp/MCPConnectionManager.js';
import { useAppState } from '../../state/AppState.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';

function MCPToggle(t0) {
  const $ = _c(7);
  const {
    action,
    target,
    onComplete
  } = t0;
  const mcpClients = useAppState(_temp);
  const toggleMcpServer = useMcpToggleEnabled();
  const didRun = useRef(false);
  let t1;
  let t2;
  if ($[0] !== action || $[1] !== mcpClients || $[2] !== onComplete || $[3] !== target || $[4] !== toggleMcpServer) {
    t1 = () => {
      if (didRun.current) return;
      didRun.current = true;
      const isEnabling = action === "enable";
      const clients = mcpClients.filter(_temp2);
      const toToggle = target === "all" ? clients.filter(c_0 => isEnabling ? c_0.type === "disabled" : c_0.type !== "disabled") : clients.filter(c_1 => c_1.name === target);
      if (toToggle.length === 0) {
        onComplete(target === "all" ? `All MCP servers are already ${isEnabling ? "enabled" : "disabled"}` : `MCP server "${target}" not found`);
        return;
      }
      for (const s_0 of toToggle) {
        toggleMcpServer(s_0.name);
      }
      onComplete(target === "all" ? `${isEnabling ? "Enabled" : "Disabled"} ${toToggle.length} MCP server(s)` : `MCP server "${target}" ${isEnabling ? "enabled" : "disabled"}`);
    };
    t2 = [action, target, mcpClients, toggleMcpServer, onComplete];
    $[0] = action;
    $[1] = mcpClients;
    $[2] = onComplete;
    $[3] = target;
    $[4] = toggleMcpServer;
    $[5] = t1;
    $[6] = t2;
  } else {
    t1 = $[5];
    t2 = $[6];
  }
  useEffect(t1, t2);
  return null;
}

function _temp2(c) {
  return c.name !== "ide";
}

function _temp(s) {
  return s.mcp.clients;
}

export async function call(onDone: LocalJSXCommandOnDone, _context: unknown, args?: string): Promise<React.ReactNode> {
  if (args) {
    const parts = args.trim().split(/\s+/);
    
    // Allow /mcp no-redirect to bypass the redirect for testing
    if (parts[0] === 'no-redirect') {
      return <MCPSettings onComplete={onDone} />;
    }
    if (parts[0] === 'reconnect' && parts[1]) {
      return <MCPReconnect serverName={parts.slice(1).join(' ')} onComplete={onDone} />;
    }
    if (parts[0] === 'enable' || parts[0] === 'disable') {
      return <MCPToggle action={parts[0]} target={parts.length > 1 ? parts.slice(1).join(' ') : 'all'} onComplete={onDone} />;
    }
    
    // 闭环 5-8 新增命令
    if (parts[0] === 'list') {
      return <MCPList onComplete={onDone} />;
    }
    if (parts[0] === 'connect' && parts[1]) {
      return <MCPConnect url={parts[1]} onComplete={onDone} />;
    }
    if (parts[0] === 'disconnect' && parts[1]) {
      return <MCPDisconnect serverName={parts[1]} onComplete={onDone} />;
    }
    if (parts[0] === 'reload') {
      return <MCPReload onComplete={onDone} />;
    }
    if (parts[0] === 'ping' && parts[1]) {
      return <MCPPing serverName={parts[1]} onComplete={onDone} />;
    }
    if (parts[0] === 'logs') {
      return <MCPlogs onComplete={onDone} />;
    }
    if (parts[0] === 'debug') {
      return <MCPDebug onComplete={onDone} />;
    }
  }

  // Redirect base /mcp command to /plugins installed tab for ant users
  if ("external" === 'ant') {
    return <PluginSettings onComplete={onDone} args="manage" showMcpRedirectMessage />;
  }
  return <MCPSettings onComplete={onDone} />;
}

// 闭环 5: mcp list
function MCPList({ onComplete }) {
  const mcpClients = useAppState(s => s.mcp.clients);
  useEffect(() => {
    onComplete(`MCP Servers: ${mcpClients.length}\n${mcpClients.map(c => `  - ${c.name} (${c.type})`).join('\n')}`);
  }, [mcpClients]);
  return null;
}

// 闭环 6: mcp connect (WebSocket)
function MCPConnect({ url, onComplete }) {
  const connectMcpServer = useMcpConnect();
  useEffect(() => {
    connectMcpServer(url).then(success => {
      onComplete(success ? `Connected to ${url}` : `Failed to connect to ${url}`);
    });
  }, [url]);
  return null;
}

// 闭环 7: mcp disconnect + 自动重连
function MCPDisconnect({ serverName, onComplete }) {
  const disconnectMcpServer = useMcpDisconnect();
  const reconnectMcpServer = useMcpReconnect();
  useEffect(() => {
    disconnectMcpServer(serverName);
    // 自动重连
    setTimeout(() => {
      reconnectMcpServer(serverName);
      onComplete(`Disconnected and reconnected: ${serverName}`);
    }, 500);
  }, [serverName]);
  return null;
}

// 闭环 8: mcp reload
function MCPReload({ onComplete }) {
  const reloadMcp = useMcpReload();
  useEffect(() => {
    reloadMcp();
    onComplete('MCP reloaded - settings + plugins reloaded');
  }, []);
  return null;
}

// 闭环 9: mcp ping 测试命令
function MCPPing({ serverName, onComplete }) {
  const pingMcp = useMcpPing();
  useEffect(() => {
    pingMcp(serverName).then(result => {
      onComplete(result.success ? `Ping successful: ${result.latency}ms` : `Ping failed: ${result.error}`);
    });
  }, [serverName]);
  return null;
}

// 闭环 10: mcp logs 命令
function MCPlogs({ onComplete }) {
  const mcpLogs = useAppState(s => s.mcp.logs || []);
  useEffect(() => {
    onComplete(`MCP Logs (${mcpLogs.length} entries):\n${mcpLogs.map(l => `[${l.time}] ${l.level}: ${l.message}`).join('\n')}`);
  }, [mcpLogs]);
  return null;
}

// 闭环 11: mcp debug 模式
function MCPDebug({ onComplete }) {
  const setDebugMode = useMcpDebugMode();
  useEffect(() => {
    setDebugMode(true);
    onComplete('MCP debug mode enabled - detailed logs now active');
  }, []);
  return null;
}
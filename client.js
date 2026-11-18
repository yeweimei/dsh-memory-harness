/**
 * dsh-memory — browser half.
 *
 * Two surfaces:
 *   - `settings.section` + icon: plugin settings (embedding endpoint/model/key,
 *     behavior toggles, health). Settings save live, no plugin restart.
 *   - `sidebar.panellist` icon + `main` panel: the memory browser (search,
 *     filters, create, edit, delete, usage statistics).
 *
 * Host data travels over the package-private Remote channel registered by the
 * Host half (`connection.rpc.call('/api', 'dsh-memory/<method>', { args })`).
 * This module needs no imports beyond React and no build step.
 */
window.__ModuleLoader__.load({
  id: 'dsh-memory-harness',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const RPC_PREFIX = 'dsh-memory/'
    const KINDS = ['preference', 'project', 'decision', 'knowledge', 'task', 'other']
    const SCOPES = ['global', 'workspace', 'session']

    const KIND_LABELS = {
      preference: ['preference', '偏好'],
      project: ['project', '项目'],
      decision: ['decision', '决策'],
      knowledge: ['knowledge', '知识'],
      task: ['task', '任务'],
      other: ['other', '其他'],
    }
    const STATUS_LABELS = {
      active: ['active', '生效'],
      candidate: ['candidate', '候选'],
      dismissed: ['dismissed', '已忽略'],
      superseded: ['superseded', '被取代'],
      archived: ['archived', '已归档'],
    }

    const SCOPE_LABELS = {
      global: ['global', '全局'],
      workspace: ['workspace', '工作区'],
      session: ['session', '会话'],
    }

    const PAGE_CSS = `
.dsh-memory-main { flex: 1 1 auto; width: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.dsh-memory-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 20px clamp(16px, 3vw, 32px) 48px; box-sizing: border-box; overscroll-behavior: contain; }
.dsh-memory-main .dsh-memory-page { max-width: 1000px; margin: 0 auto; }
.dsh-memory-loadmore { display: flex; justify-content: center; padding: 4px 0 12px; }
.dsh-memory-history { border-left: 2px solid var(--dsw-alias-border-l1); margin: 2px 0 8px 12px; padding: 6px 0 6px 10px; display: flex; flex-direction: column; gap: 6px; }
.dsh-memory-history-row { display: flex; flex-direction: column; gap: 2px; }
.dsh-memory-history-text { color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.dsh-memory-diff { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 8px; background: var(--dsw-alias-bg-layer-2); max-height: 320px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
.dsh-memory-diff-line { white-space: pre-wrap; word-break: break-word; }
.dsh-memory-diff-add { color: var(--dsw-alias-state-success-primary, #2e7d32); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e7d32) 10%, transparent); }
.dsh-memory-diff-del { color: var(--dsw-alias-state-error-primary, #c62828); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #c62828) 10%, transparent); }
.dsh-memory-diff-field { color: var(--dsw-alias-label-secondary); }
.dsh-memory-page { display: flex; flex-direction: column; gap: 14px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
.dsh-memory-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.dsh-memory-header-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsh-memory-title { font-size: 16px; font-weight: 600; margin: 0; }
.dsh-memory-subtitle { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-memory-banner { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; padding: 8px 10px; color: var(--dsw-alias-state-warn-primary); font-size: 12px; }
.dsh-memory-banner.error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dsh-memory-banner.ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.dsh-memory-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.dsh-memory-search-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-memory-search-row .dsh-memory-input { flex: 1 1 220px; min-width: 180px; }
.dsh-memory-input, .dsh-memory-select, .dsh-memory-textarea {
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px 9px; font: inherit; outline: none;
}
.dsh-memory-input:focus, .dsh-memory-select:focus, .dsh-memory-textarea:focus { border-color: var(--dsw-alias-brand-primary); }
.dsh-memory-input { flex: 1 1 220px; min-width: 160px; }
.dsh-memory-textarea { resize: vertical; min-height: 54px; flex: 1 1 100%; }
.dsh-memory-form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px; background: var(--dsw-alias-bg-layer-1); }
.dsh-memory-form-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; width: 100%; }
.dsh-memory-button {
  border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: inherit;
  border-radius: 8px; padding: 6px 11px; cursor: pointer; font: inherit; white-space: nowrap;
}
.dsh-memory-button:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-memory-button.primary { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }
.dsh-memory-button.danger { color: var(--dsw-alias-state-error-primary); }
.dsh-memory-button:disabled { opacity: 0.55; cursor: default; }
.dsh-memory-list { display: flex; flex-direction: column; gap: 8px; }
.dsh-memory-row { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 6px; }
.dsh-memory-row-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dsh-memory-text { margin: 0; white-space: pre-wrap; word-break: break-word; }
.dsh-memory-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-memory-badge { border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px; padding: 0 8px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-memory-badge.strong { color: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-memory-actions { display: flex; gap: 6px; margin-left: auto; }
.dsh-memory-empty { color: var(--dsw-alias-label-secondary); padding: 28px 12px; text-align: center; }
.dsh-memory-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
.dsh-memory-loading { color: var(--dsw-alias-label-secondary); padding: 18px 0; }
.dsh-memory-section { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); overflow: hidden; }
.dsh-memory-section > summary { cursor: pointer; list-style: none; padding: 12px 14px; display: flex; flex-direction: column; gap: 2px; }
.dsh-memory-section > summary::-webkit-details-marker { display: none; }
.dsh-memory-section > summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-memory-section[open] > summary { border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dsh-memory-section-title { font-size: 13px; font-weight: 600; }
.dsh-memory-section-desc { font-size: 11px; color: var(--dsw-alias-label-secondary); line-height: 1.4; }
.dsh-memory-section > :not(summary) { margin: 10px 14px 0; }
.dsh-memory-section > :last-child { margin-bottom: 14px; }
.dsh-memory-grid > .dsh-memory-banner, .dsh-memory-grid > .dsh-memory-meta, .dsh-memory-grid > .dsh-memory-actions-row, .dsh-memory-grid > .dsh-memory-hint { grid-column: 1 / -1; }
.dsh-memory-savebar { position: sticky; bottom: 0; z-index: 5; display: flex; gap: 8px; align-items: center; justify-content: flex-end; padding: 10px 0; background: linear-gradient(to top, var(--dsw-alias-bg-base) 70%, transparent); }
.dsh-memory-more { display: inline-block; }
.dsh-memory-warning { font-size: 12px; color: var(--dsw-alias-state-warn-primary); }
.dsh-memory-warning.error { color: var(--dsw-alias-state-error-primary); }
.dsh-memory-warning.info { color: var(--dsw-alias-label-secondary); }
.dsh-memory-run { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-memory-run strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-memory-explain { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-memory-explain > summary { cursor: pointer; list-style: none; color: var(--dsw-alias-label-tertiary); }
.dsh-memory-explain > summary::-webkit-details-marker { display: none; }
.dsh-memory-explain-body { display: flex; flex-direction: column; gap: 2px; padding: 4px 0 0 8px; border-left: 2px solid var(--dsw-alias-border-l1); }
.dsh-memory-feedback { display: flex; gap: 4px; }
.dsh-memory-feedback button { border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 6px; font-size: 11px; padding: 1px 6px; cursor: pointer; }
.dsh-memory-feedback button:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dsh-memory-trend { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--dsw-alias-label-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.dsh-memory-trend-row { display: flex; gap: 10px; flex-wrap: wrap; }
.dsh-memory-trend-row strong { color: var(--dsw-alias-label-primary); font-weight: 500; }
.dsh-memory-diagnostics { display: flex; flex-direction: column; gap: 12px; }
.dsh-memory-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(108px, 1fr)); gap: 8px; }
.dsh-memory-kpi { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 9px 11px; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 1px; }
.dsh-memory-kpi-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-memory-kpi-value { font-size: 18px; font-weight: 600; line-height: 1.2; }
.dsh-memory-chart-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.dsh-memory-chart { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 9px 11px; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 5px; }
.dsh-memory-chart-title { font-size: 12px; font-weight: 600; }
.dsh-memory-chart-bars { display: flex; align-items: flex-end; gap: 4px; height: 64px; }
.dsh-memory-chart-col { flex: 1; display: flex; align-items: flex-end; height: 100%; }
.dsh-memory-chart-bar { width: 100%; border-radius: 3px 3px 0 0; background: var(--dsw-alias-brand-primary); min-height: 2px; }
.dsh-memory-chart-bar.warn { background: var(--dsw-alias-state-warn-primary); }
.dsh-memory-chart-bar.bad { background: var(--dsw-alias-state-error-primary); }
.dsh-memory-chart-bar.good { background: var(--dsw-alias-state-success-primary, #2e7d32); }
.dsh-memory-chart-labels { display: flex; gap: 4px; font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dsh-memory-chart-labels span { flex: 1; text-align: center; }
.dsh-memory-budget { display: flex; flex-direction: column; gap: 4px; }
.dsh-memory-budget-head { display: flex; justify-content: space-between; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-memory-progress { height: 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
.dsh-memory-progress-fill { height: 100%; background: var(--dsw-alias-brand-primary); border-radius: 999px; }
.dsh-memory-progress-fill.warn { background: var(--dsw-alias-state-warn-primary); }
.dsh-memory-run-row { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; padding: 4px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.dsh-memory-warning-card { border: 1px solid var(--dsw-alias-border-l1); border-left: 3px solid var(--dsw-alias-state-warn-primary); border-radius: 8px; padding: 7px 10px; font-size: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-state-warn-primary); }
.dsh-memory-warning-card.error { border-left-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dsh-memory-warning-card.info { border-left-color: var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
.dsh-memory-line-chart { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 6px; }
.dsh-memory-line-chart svg { width: 100%; height: 190px; display: block; }
.dsh-memory-legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--dsw-alias-label-secondary); }
.dsh-memory-legend span { display: inline-flex; align-items: center; gap: 4px; }
.dsh-memory-legend i { width: 10px; height: 3px; border-radius: 2px; display: inline-block; }
.dsh-memory-dock-anchor { position: relative; width: 100%; display: flex; justify-content: flex-start; padding-left: max(8px, calc((100% - var(--dsh-composer-card-max-width, 720px)) / 2 + 8px)); box-sizing: border-box; pointer-events: none; }
.dsh-memory-dock-pill { pointer-events: auto; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1)); color: var(--dsw-alias-label-secondary); border-radius: 999px; padding: 5px 12px; font: inherit; font-size: 12px; line-height: 1.4; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.08); transition: transform .12s ease, box-shadow .12s ease; }
.dsh-memory-dock-pill:hover { color: var(--dsw-alias-label-primary); box-shadow: 0 3px 12px rgba(0,0,0,.12); transform: translateY(-1px); }
.dsh-memory-dock-pill.active { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-memory-dock-panel { position: absolute; left: 0; bottom: calc(100% + 8px); width: min(390px, calc(100vw - 40px)); max-height: min(60vh, 480px); overflow: auto; border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px; background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1)); box-shadow: 0 14px 36px rgba(0,0,0,.18); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; pointer-events: auto; z-index: 50; animation: dsh-memory-dock-in .16s ease-out; }
.dsh-memory-dock-header { display: flex; align-items: center; gap: 8px; }
.dsh-memory-dock-title { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dsh-memory-dock-count { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-memory-dock-close { margin-left: auto; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; font: inherit; font-size: 16px; line-height: 1; padding: 2px 4px; }
.dsh-memory-dock-group { display: flex; flex-direction: column; gap: 6px; }
.dsh-memory-dock-group-title { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dsh-memory-dock-memory { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 6px; }
.dsh-memory-dock-text { font-size: 12px; color: var(--dsw-alias-label-primary); line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.dsh-memory-dock-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.dsh-memory-dock-axis { display: flex; gap: 4px; flex-wrap: wrap; align-items: center; margin-top: 2px; }
.dsh-memory-dock-axis.content { opacity: .82; }
.dsh-memory-dock-axis-label { font-size: 10px; color: var(--dsw-alias-label-tertiary); min-width: 86px; }
.dsh-memory-dock-rating.content { font-size: 10px; padding: 1px 6px; opacity: .9; }
.dsh-memory-dock-rating { border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 6px; font-size: 11px; padding: 2px 7px; cursor: pointer; transition: background .1s ease, color .1s ease; }
.dsh-memory-dock-rating:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dsh-memory-dock-rating.selected { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }
.dsh-memory-dock-footer { display: flex; gap: 8px; align-items: center; justify-content: flex-end; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 8px; }
.dsh-memory-dock-submit { border: 0; border-radius: 8px; background: var(--dsw-alias-brand-primary); color: #fff; font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer; }
.dsh-memory-dock-submit:disabled { opacity: .45; cursor: default; }
.dsh-memory-dock-cancel { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-memory-dock-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dsh-memory-dock-undo { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 5px 12px; cursor: pointer; }
.dsh-memory-dock-undo:disabled { opacity: .45; cursor: default; }
.dsh-memory-dock-error { font-size: 11px; color: var(--dsw-alias-state-error-primary); }
.dsh-memory-dock-success { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dsw-alias-state-success-primary, #2e7d32); animation: dsh-memory-check .5s cubic-bezier(.2,.8,.3,1.2); }
.dsh-memory-dock-panel.submitted { animation: dsh-memory-dock-success .55s ease; }
@keyframes dsh-memory-dock-in { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes dsh-memory-check { 0% { opacity: 0; transform: scale(.6); } 55% { opacity: 1; transform: scale(1.18); } 100% { opacity: 1; transform: scale(1); } }
@keyframes dsh-memory-dock-success { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e7d32) 40%, transparent); } 100% { box-shadow: 0 0 0 12px transparent; } }
.dsh-memory-grid { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 10px 14px; align-items: center; }
.dsh-memory-grid > label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-memory-grid .dsh-memory-input, .dsh-memory-grid .dsh-memory-select { flex: none; width: 100%; box-sizing: border-box; }
.dsh-memory-check { display: flex; gap: 8px; align-items: center; }
.dsh-memory-check input { accent-color: var(--dsw-alias-brand-primary); }
.dsh-memory-actions-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsh-memory-tabs { display: inline-flex; gap: 2px; align-items: center; flex-wrap: wrap; padding: 3px; border-radius: 10px; background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
.dsh-memory-tab { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); border-radius: 8px; padding: 5px 12px; cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; }
.dsh-memory-tab:hover { color: var(--dsw-alias-label-primary); }
.dsh-memory-tab.selected { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.dsh-memory-menu { position: relative; }
.dsh-memory-menu > summary { list-style: none; cursor: pointer; }
.dsh-memory-menu > summary::-webkit-details-marker { display: none; }
.dsh-memory-menu-panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 40; min-width: 248px; padding: 6px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); box-shadow: 0 8px 24px rgba(0,0,0,.14); display: flex; flex-direction: column; gap: 2px; }
.dsh-memory-menu-item { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; text-align: left; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; padding: 7px 9px; border-radius: 7px; cursor: pointer; }
.dsh-memory-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-memory-menu-item small { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.35; }
.dsh-memory-menu-item.danger { color: var(--dsw-alias-state-error-primary); }
.dsh-memory-row-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.dsh-memory-badge.warn { color: var(--dsw-alias-state-warn-primary); border-color: var(--dsw-alias-state-warn-primary); }
.dsh-memory-project { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 12px; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 8px; }
.dsh-memory-project-title { font-weight: 600; word-break: break-all; }
.dsh-memory-project-section { display: flex; flex-direction: column; gap: 4px; }
.dsh-memory-project-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-memory-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-memory-advanced { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
.dsh-memory-advanced > summary { cursor: pointer; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dsh-memory-advanced[open] > summary { color: var(--dsw-alias-label-primary); }
.dsh-memory-conflicts { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.dsh-memory-conflict-card { border: 1px solid var(--dsw-alias-state-warn-primary); border-radius: 10px; padding: 10px; background: var(--dsw-alias-bg-layer-1); display: flex; flex-direction: column; gap: 6px; }
.dsh-memory-conflict-side { display: flex; flex-direction: column; gap: 2px; }
`

    function errorText(error) {
      return error instanceof Error ? error.message : String(error)
    }

    function labelOf(table, key, t) {
      const pair = table[key] ?? table.other ?? [String(key), String(key)]
      return t(pair[0], pair[1])
    }

    function shortPath(value) {
      if (typeof value !== 'string') return ''
      const parts = value.split(/[\\/]/).filter(Boolean)
      return parts.length <= 2 ? value : `…/${parts.slice(-2).join('/')}`
    }

    function formatAge(ageDays) {
      if (typeof ageDays !== 'number' || !Number.isFinite(ageDays)) return ''
      if (ageDays < 0.5) return 'today'
      if (ageDays < 30) return `${Math.round(ageDays)}d ago`
      if (ageDays < 365) return `${Math.round(ageDays / 30)}mo ago`
      return `${Math.round(ageDays / 365)}y ago`
    }

    class MemoryClient {
      constructor(rpc) {
        this.rpc = rpc
      }

      async call(method, args, signal) {
        if (this.rpc === undefined || this.rpc === null || typeof this.rpc.call !== 'function') {
          throw new Error('memory host connection is unavailable')
        }
        const result = await this.rpc.call('/api', RPC_PREFIX + method, { args: args ?? {} }, signal)
        if (result === undefined || result === null) throw new Error('memory request was dropped')
        if (result.ok !== true) {
          const message = result.error && result.error.message ? result.error.message : 'memory request failed'
          throw new Error(message)
        }
        return result.value
      }

      list(args) {
        return this.call('list', args)
      }

      search(args) {
        return this.call('search', args)
      }

      save(args) {
        return this.call('save', args)
      }

      update(args) {
        return this.call('update', args)
      }

      remove(args) {
        return this.call('delete', args)
      }

      stats() {
        return this.call('stats')
      }

      candidates(args) {
        return this.call('candidates', args)
      }

      confirmCandidate(args) {
        return this.call('confirmCandidate', args)
      }

      dismissCandidate(args) {
        return this.call('dismissCandidate', args)
      }

      extractNow() {
        return this.call('extractNow')
      }

      projects() {
        return this.call('projects')
      }

      previewExtraction(args) {
        return this.call('previewExtraction', args)
      }

      admitNow() {
        return this.call('admitNow')
      }

      consolidateNow() {
        return this.call('consolidateNow')
      }

      rollback(id, revision) {
        return this.call('rollback', { id, revision })
      }

      diffRevisions(id, fromRevision, toRevision) {
        return this.call('diffRevisions', { id, fromRevision, toRevision })
      }

      importData(bundle, fileName) {
        return this.call('importData', { bundle, fileName })
      }

      listBackups() {
        return this.call('listBackups')
      }

      createBackup(label) {
        return this.call('createBackup', { label })
      }

      restoreBackup(name) {
        return this.call('restoreBackup', { name })
      }

      diagnostics() {
        return this.call('diagnostics')
      }

      feedback(id, action, query) {
        return this.call('feedback', { id, action, query })
      }

      recalls(sessionId, limit) {
        return this.call('recalls', { sessionId, limit })
      }

      rateRecall(recallId, memoryId, rating, note, axis) {
        return this.call('rateRecall', { recallId, memoryId, rating, note, axis })
      }

      clearRecallRating(recallId, memoryId, axis) {
        return this.call('clearRecallRating', { recallId, memoryId, axis })
      }

      markRecallsReviewed(recallIds, reviewed) {
        return this.call('markRecallsReviewed', { recallIds, reviewed })
      }

      reviewQueue(limit, offset) {
        return this.call('reviewQueue', { limit, offset })
      }

      keepReview(id) {
        return this.call('keepReview', { id })
      }

      conflicts() {
        return this.call('conflicts')
      }

      resolveConflict(id, resolution) {
        return this.call('resolveConflict', { id, resolution })
      }

      quality(days) {
        return this.call('quality', { days })
      }

      events(limit, kind) {
        return this.call('events', { limit, kind })
      }

      exportDiagnostics() {
        return this.call('exportDiagnostics')
      }

      restore(id) {
        return this.call('restore', { id })
      }

      archive(id) {
        return this.call('archive', { id })
      }

      history(id, limit) {
        return this.call('history', { id, limit })
      }

      exportData(args) {
        return this.call('exportData', args)
      }

      getSettings() {
        return this.call('getSettings')
      }

      setSettings(patch) {
        return this.call('setSettings', { patch })
      }
    }

    const RELEVANCE_RATINGS = [
      ['very_relevant', 'Very relevant', '非常相关'],
      ['relevant', 'Relevant', '相关'],
      ['somewhat_relevant', 'Somewhat relevant', '一般相关'],
      ['irrelevant', 'Irrelevant', '不相关'],
    ]
    const CONTENT_RATINGS = [
      ['valid', 'Still valid', '仍然有效'],
      ['outdated', 'Outdated', '过时'],
      ['incorrect', 'Incorrect', '错误'],
      ['duplicate', 'Duplicate', '重复'],
    ]
    const RATING_AXES = ['relevance', 'content']

    function MemoryRecallDock(props) {
      const client = props.client
      const t = props.t
      const sessionId = props.sessionId
      const [state, setState] = useState(null)
      const [expanded, setExpanded] = useState(false)
      const [draft, setDraft] = useState({})
      const [submitting, setSubmitting] = useState(false)
      const [submitted, setSubmitted] = useState(null)
      const [hiddenRecallIds, setHiddenRecallIds] = useState([])
      const [undoUntil, setUndoUntil] = useState(0)
      const [now, setNow] = useState(Date.now())
      const [undoBusy, setUndoBusy] = useState(false)
      const [error, setError] = useState(null)
      const requestRef = useRef(0)
      const running = typeof props.useSession === 'function' ? props.useSession((current) => current.running) : false

      async function refresh() {
        if (typeof sessionId !== 'string' || sessionId === '') {
          setState(null)
          return
        }
        const requestId = ++requestRef.current
        try {
          const next = await client.recalls(sessionId, 10)
          if (requestId !== requestRef.current) return
          setState(next)
          setError(null)
        } catch (failure) {
          if (requestId === requestRef.current) setError(errorText(failure))
        }
      }

      useEffect(() => {
        setDraft({})
        setSubmitted(null)
        setHiddenRecallIds([])
        setUndoUntil(0)
        void refresh()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [sessionId])

      useEffect(() => {
        void refresh()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [running])

      useEffect(() => {
        if (running !== true || typeof sessionId !== 'string' || sessionId === '') return undefined
        const timer = setInterval(() => void refresh(), 3000)
        return () => clearInterval(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [running, sessionId])

      useEffect(() => {
        if (submitted === null) return undefined
        const timer = setInterval(() => setNow(Date.now()), 250)
        return () => clearInterval(timer)
      }, [submitted])

      useEffect(() => {
        if (submitted === null || now < undoUntil) return undefined
        const timer = setTimeout(() => {
          setSubmitted(null)
          setExpanded(false)
        }, 1400)
        return () => clearTimeout(timer)
      }, [submitted, now, undoUntil])

      function keyOf(recallId, memoryId, axis) {
        return `${recallId}:${memoryId}:${axis}`
      }

      function currentRating(memory, axis) {
        const explicit = memory.ratings?.[axis]?.rating
        if (explicit !== undefined && explicit !== null) return explicit
        return axis === 'relevance' ? memory.rating?.rating ?? null : null
      }

      function selectRating(recallId, memoryId, axis, rating) {
        if (submitted !== null) return
        setError(null)
        setDraft((current) => ({ ...current, [keyOf(recallId, memoryId, axis)]: rating }))
      }

      const visibleRecalls = state === null || !Array.isArray(state.recalls)
        ? []
        : state.recalls.filter((recall) => !hiddenRecallIds.includes(recall.recallId))
      const memories = visibleRecalls.flatMap((recall) => recall.memories
        .filter((memory) => memory.missing !== true)
        .map((memory) => ({ recall, memory })))

      const pending = []
      for (const entry of memories) {
        for (const axis of RATING_AXES) {
          const key = keyOf(entry.recall.recallId, entry.memory.id, axis)
          const selected = draft[key]
          if (selected === undefined || selected === currentRating(entry.memory, axis)) continue
          pending.push({
            recallId: entry.recall.recallId,
            memoryId: entry.memory.id,
            axis,
            rating: selected,
            previousRating: currentRating(entry.memory, axis),
          })
        }
      }

      async function submit() {
        if (submitting || submitted !== null || pending.length === 0) return
        setSubmitting(true)
        setError(null)
        try {
          for (const entry of pending) {
            await client.rateRecall(entry.recallId, entry.memoryId, entry.rating, undefined, entry.axis)
          }
          const recallIds = [...new Set(memories.map((entry) => entry.recall.recallId))]
          try {
            await client.markRecallsReviewed(recallIds, true)
          } catch (markFailure) {
            setError(errorText(markFailure))
          }
          setHiddenRecallIds((current) => [...new Set([...current, ...recallIds])])
          setState((current) => current === null
            ? current
            : { ...current, recalls: current.recalls.filter((recall) => !recallIds.includes(recall.recallId)) })
          setSubmitted({
            count: pending.length,
            recallIds,
            entries: pending.map((entry) => ({
              recallId: entry.recallId,
              memoryId: entry.memoryId,
              axis: entry.axis,
              previousRating: entry.previousRating,
            })),
          })
          setUndoUntil(Date.now() + 10000)
          setNow(Date.now())
          setDraft({})
          // Show the success state briefly, then get out of the composer's way.
          setTimeout(() => setExpanded(false), 1200)
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setSubmitting(false)
        }
      }

      async function undo() {
        if (submitted === null || undoBusy || now >= undoUntil) return
        setUndoBusy(true)
        setError(null)
        try {
          for (const entry of submitted.entries) {
            if (entry.previousRating === null) await client.clearRecallRating(entry.recallId, entry.memoryId, entry.axis)
            else await client.rateRecall(entry.recallId, entry.memoryId, entry.previousRating, undefined, entry.axis)
          }
          try {
            await client.markRecallsReviewed(submitted.recallIds, false)
          } catch (markFailure) {
            setError(errorText(markFailure))
          }
          setHiddenRecallIds((current) => current.filter((id) => !submitted.recallIds.includes(id)))
          setSubmitted(null)
          setUndoUntil(0)
          setDraft({})
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setUndoBusy(false)
        }
      }

      function closePanel() {
        if (submitted !== null) {
          setSubmitted(null)
          setUndoUntil(0)
        }
        setExpanded(false)
      }

      if (state === null || state.enabled === false) return null
      if (memories.length === 0 && submitted === null) return null
      const total = memories.length
      const unrated = memories.filter((entry) => currentRating(entry.memory, 'relevance') === null).length
      const undoAvailable = submitted !== null && now < undoUntil
      const undoRemaining = Math.max(0, Math.ceil((undoUntil - now) / 1000))
      return h(
        'div',
        { className: 'dsh-memory-dock-anchor' },
        h('style', null, PAGE_CSS),
        h(
          'button',
          {
            type: 'button',
            className: `dsh-memory-dock-pill${expanded ? ' active' : ''}`,
            onClick: () => setExpanded((value) => !value),
          },
          h('span', null, `🧠 ${t('Recall review', '召回评价')}`),
          submitted !== null
            ? h('span', null, `✓ ${t('submitted', '已提交')} · ${t('Undo', '撤销')} ${undoRemaining}s`)
            : unrated > 0
              ? h('span', null, `${unrated} ${t('unrated', '未评价相关度')}`)
              : h('span', null, t('relevance rated', '相关度已评价')),
          h('span', null, expanded ? '▾' : '▸'),
        ),
        expanded
          ? h(
              'div',
              { className: `dsh-memory-dock-panel${submitted !== null ? ' submitted' : ''}` },
              h(
                'div',
                { className: 'dsh-memory-dock-header' },
                h('span', { className: 'dsh-memory-dock-title' }, submitted !== null ? t('Feedback submitted', '反馈已提交') : t('Memory feedback', '记忆反馈')),
                submitted === null ? h('span', { className: 'dsh-memory-dock-count' }, `${total - unrated}/${total} ${t('relevance rated', '相关度已评价')}`) : null,
                h('button', { type: 'button', className: 'dsh-memory-dock-close', onClick: closePanel }, '×'),
              ),
              submitted !== null
                ? h(
                    React.Fragment,
                    null,
                    h('div', { className: 'dsh-memory-dock-success' }, h('span', null, '✓'), `${t('Submitted', '已提交')} ${submitted.count} ${t('feedback item(s)', '条反馈')}`),
                    h('div', { className: 'dsh-memory-dock-hint' }, t('Undo within 10 seconds if you want to re-rate these memories.', '如需重新评价，请在 10 秒内撤销。')),
                  )
                : h(
                    React.Fragment,
                    null,
                    ...visibleRecalls.map((recall) =>
                      h(
                        'div',
                        { key: recall.recallId, className: 'dsh-memory-dock-group' },
                        h(
                          'div',
                          { className: 'dsh-memory-dock-group-title' },
                          `${recall.source}${recall.turn !== null ? ` · turn ${recall.turn}` : ''} · ${new Date(recall.at).toLocaleTimeString()}`,
                        ),
                        ...recall.memories
                          .filter((memory) => memory.missing !== true)
                          .map((memory) => {
                            const relevance = draft[keyOf(recall.recallId, memory.id, 'relevance')] ?? currentRating(memory, 'relevance')
                            const content = draft[keyOf(recall.recallId, memory.id, 'content')] ?? currentRating(memory, 'content')
                            return h(
                              'div',
                              { key: `${recall.recallId}:${memory.id}`, className: 'dsh-memory-dock-memory' },
                              h('div', { className: 'dsh-memory-dock-text' }, memory.text || memory.id),
                              h(
                                'div',
                                { className: 'dsh-memory-dock-axis' },
                                h('span', { className: 'dsh-memory-dock-axis-label' }, t('Relevant this turn?', '本次相关吗？')),
                                ...RELEVANCE_RATINGS.map(([value, en, zh]) =>
                                  h(
                                    'button',
                                    {
                                      key: value,
                                      type: 'button',
                                      className: `dsh-memory-dock-rating${relevance === value ? ' selected' : ''}`,
                                      onClick: () => selectRating(recall.recallId, memory.id, 'relevance', value),
                                    },
                                    t(en, zh),
                                  ),
                                ),
                              ),
                              h(
                                'div',
                                { className: 'dsh-memory-dock-axis content' },
                                h('span', { className: 'dsh-memory-dock-axis-label' }, t('Memory itself (optional)', '记忆本身（可选）')),
                                ...CONTENT_RATINGS.map(([value, en, zh]) =>
                                  h(
                                    'button',
                                    {
                                      key: value,
                                      type: 'button',
                                      className: `dsh-memory-dock-rating content${content === value ? ' selected' : ''}`,
                                      onClick: () => selectRating(recall.recallId, memory.id, 'content', value),
                                    },
                                    t(en, zh),
                                  ),
                                ),
                              ),
                            )
                          }),
                      ),
                    ),
                  ),
              error !== null ? h('div', { className: 'dsh-memory-dock-error' }, error) : null,
              h(
                'div',
                { className: 'dsh-memory-dock-footer' },
                submitted !== null
                  ? h(
                      React.Fragment,
                      null,
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-memory-dock-undo',
                          disabled: !undoAvailable || undoBusy,
                          onClick: () => void undo(),
                        },
                        undoBusy
                          ? t('Undoing…', '撤销中…')
                          : undoAvailable
                            ? `${t('Undo', '撤销')} (${undoRemaining}s)`
                            : t('Undo expired', '撤销已过期'),
                      ),
                      h('button', { type: 'button', className: 'dsh-memory-dock-cancel', onClick: closePanel }, t('Close', '关闭')),
                    )
                  : h(
                      React.Fragment,
                      null,
                      h('button', { type: 'button', className: 'dsh-memory-dock-cancel', onClick: () => setDraft({}) }, t('Cancel', '取消')),
                      h(
                        'button',
                        {
                          type: 'button',
                          className: 'dsh-memory-dock-submit',
                          disabled: submitting || pending.length === 0,
                          onClick: () => void submit(),
                        },
                        submitting ? t('Submitting…', '提交中…') : `${t('Submit', '提交')}${pending.length > 0 ? ` (${pending.length})` : ''}`,
                      ),
                    ),
              ),
            )
          : null,
      )
    }

    function MemoryIcon(props) {
      const size = props && typeof props.size === 'number' ? props.size : 18
      const active = props && props.active === true
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          'aria-hidden': true,
          style: { display: 'block' },
        },
        h('rect', {
          x: 3.5,
          y: 4.5,
          width: 17,
          height: 15,
          rx: 4,
          stroke: 'currentColor',
          strokeWidth: active ? 2 : 1.6,
        }),
        h('path', { d: 'M7.5 9h9M7.5 12.5h9M7.5 16h5.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      )
    }

    // ------------------------------------------------------------------ browser

    function explainLines(explain, t) {
      const lines = []
      if (explain.route === 'graph') {
        lines.push(`${t('route', '路径')}: graph · via ${explain.via}${explain.depth !== null && explain.depth !== undefined ? ` · depth ${explain.depth}` : ''}`)
        lines.push(`${t('score', '分数')}: ${explain.score}`)
        return lines
      }
      lines.push(`${t('route', '路径')}: ${explain.route} · ${t('score', '分数')} ${explain.score}`)
      if (explain.semantic !== null && explain.semantic !== undefined) {
        lines.push(`semantic: rank ${explain.semantic.rank} · similarity ${explain.semantic.similarity} · +${explain.semantic.contribution}`)
      }
      if (explain.keyword !== null && explain.keyword !== undefined) {
        lines.push(`keyword: rank ${explain.keyword.rank} · bm25 ${explain.keyword.score} · +${explain.keyword.contribution}`)
      }
      lines.push(`RRF k=${explain.rrf.k}`)
      return lines
    }

    function MemoryRow(props) {
      const memory = props.memory
      const t = props.t
      const mode = props.mode ?? 'active'
      const editing = props.editingId === memory.id
      const confirming = props.confirmingId === memory.id
      const busy = props.busyId === memory.id
      return h(
        'div',
        { className: 'dsh-memory-row' },
        h(
          'div',
          { className: 'dsh-memory-row-top' },
          h('span', { className: 'dsh-memory-badge strong' }, labelOf(KIND_LABELS, memory.kind, t)),
          h('span', { className: 'dsh-memory-badge' }, labelOf(SCOPE_LABELS, memory.scope, t)),
          memory.workspace !== null && memory.scope === 'workspace'
            ? h('span', { className: 'dsh-memory-badge' }, shortPath(memory.workspace))
            : null,
          h('span', { className: 'dsh-memory-badge' }, `${t('importance', '重要度')} ${memory.importance}`),
          typeof memory.validUntil === 'number'
            ? h('span', { className: 'dsh-memory-badge' },
                memory.validUntil < Date.now()
                  ? `${t('expired', '已过期')} ${new Date(memory.validUntil).toLocaleDateString()}`
                  : `${t('until', '至')} ${new Date(memory.validUntil).toLocaleDateString()}`)
            : null,
          ...(memory.tags || []).map((tag) => h('span', { key: `tag-${tag}`, className: 'dsh-memory-badge' }, `#${tag}`)),
          h(
            'div',
            { className: 'dsh-memory-actions' },
            mode === 'review'
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'span',
                    { className: 'dsh-memory-badge warn' },
                    memory.reviewReason === 'outdated'
                      ? t('outdated — review', '过时 — 待复核')
                      : memory.reviewReason === 'incorrect'
                        ? t('incorrect — review', '错误 — 待复核')
                        : memory.reviewReason === 'duplicate'
                          ? t('duplicate — review', '重复 — 待复核')
                          : memory.reviewReason === 'conflict'
                            ? t('possible conflict', '可能冲突')
                            : memory.reviewReason === 'expired'
                              ? t('expired — review', '已过期 — 待复核')
                              : t('needs review', '待复核'),
                  ),
                  typeof memory.qualityScore === 'number' && memory.qualityScore !== 0
                    ? h('span', { className: 'dsh-memory-badge' }, `q ${memory.qualityScore.toFixed(2)}`)
                    : null,
                  editing
                    ? h(
                        React.Fragment,
                        null,
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-memory-button primary',
                            disabled: busy,
                            onClick: () => props.onSaveEdit(memory.id, props.editText),
                          },
                          t('Save', '保存'),
                        ),
                        h('button', { type: 'button', className: 'dsh-memory-button', disabled: busy, onClick: props.onCancelEdit }, t('Cancel', '取消')),
                      )
                    : h(
                        React.Fragment,
                        null,
                        h('button', { type: 'button', className: 'dsh-memory-button', disabled: busy, onClick: () => props.onStartEdit(memory) }, t('Edit', '编辑')),
                        h('button', { type: 'button', className: 'dsh-memory-button', disabled: busy, onClick: () => props.onHistory(memory.id) }, t('History', '历史')),
                        h(
                          'button',
                          { type: 'button', className: 'dsh-memory-button primary', disabled: busy, onClick: () => props.onKeep(memory.id) },
                          t('Keep', '保留'),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'dsh-memory-button danger', disabled: busy, onClick: () => props.onArchive(memory.id) },
                          t('Archive', '归档'),
                        ),
                      ),
                )
              : mode !== 'active'
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'span',
                    { className: 'dsh-memory-badge warn' },
                    `${t('candidate', '候选')}${typeof memory.details?.confidence === 'number' ? ` ${memory.details.confidence}` : ''}`,
                  ),
                  mode === 'candidate'
                    ? h(
                        React.Fragment,
                        null,
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-memory-button',
                            disabled: busy,
                            onClick: () => props.onStartEdit(memory),
                          },
                          t('Edit', '编辑'),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'dsh-memory-button', disabled: busy, onClick: () => props.onHistory(memory.id) },
                          t('History', '历史'),
                        ),
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-memory-button primary',
                            disabled: busy,
                            onClick: () => props.onConfirm(memory.id),
                          },
                          t('Accept', '接受'),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'dsh-memory-button danger', disabled: busy, onClick: () => props.onDismiss(memory.id) },
                          t('Ignore', '忽略'),
                        ),
                      )
                    : h(
                        React.Fragment,
                        null,
                        h('span', { className: 'dsh-memory-badge' }, labelOf(STATUS_LABELS, memory.status, t)),
                        h(
                          'button',
                          { type: 'button', className: 'dsh-memory-button', disabled: busy, onClick: () => props.onHistory(memory.id) },
                          t('History', '历史'),
                        ),
                        h(
                          'button',
                          { type: 'button', className: 'dsh-memory-button', disabled: busy, onClick: () => props.onRestore(memory.id) },
                          t('Restore', '恢复'),
                        ),
                      ),
                )
              : editing
              ? h(
                  React.Fragment,
                  null,
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-memory-button primary',
                      disabled: busy,
                      onClick: () => props.onSaveEdit(memory.id, props.editText),
                    },
                    t('Save', '保存'),
                  ),
                  h(
                    'button',
                    { type: 'button', className: 'dsh-memory-button', disabled: busy, onClick: props.onCancelEdit },
                    t('Cancel', '取消'),
                  ),
                )
              : h(
                  React.Fragment,
                  null,
                  h('button', { type: 'button', className: 'dsh-memory-button', onClick: () => props.onStartEdit(memory) }, t('Edit', '编辑')),
                  h('button', { type: 'button', className: 'dsh-memory-button', onClick: () => props.onHistory(memory.id) }, t('History', '历史')),
                  confirming
                    ? h(
                        React.Fragment,
                        null,
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dsh-memory-button danger',
                            disabled: busy,
                            onClick: () => props.onDelete(memory.id),
                          },
                          t('Confirm delete', '确认删除'),
                        ),
                        h('button', { type: 'button', className: 'dsh-memory-button', onClick: props.onCancelDelete }, t('Cancel', '取消')),
                      )
                    : h(
                        'details',
                        { className: 'dsh-memory-more' },
                        h('summary', { className: 'dsh-memory-button' }, t('More', '更多')),
                        h(
                          'div',
                          { className: 'dsh-memory-menu-panel' },
                          h(
                            'button',
                            { type: 'button', className: 'dsh-memory-menu-item', disabled: busy, onClick: (event) => { event.currentTarget.closest('details')?.removeAttribute('open'); props.onArchive(memory.id) } },
                            t('Archive', '归档'),
                            h('small', null, t('move to the cold tier; restore later', '移到冷数据层，可恢复')),
                          ),
                          h(
                            'button',
                            { type: 'button', className: 'dsh-memory-menu-item danger', onClick: (event) => { event.currentTarget.closest('details')?.removeAttribute('open'); props.onAskDelete(memory.id) } },
                            t('Delete', '删除'),
                            h('small', null, t('permanent; a revision snapshot is kept', '永久删除，但保留修订快照')),
                          ),
                        ),
                      ),
                ),
          ),
        ),
        editing
          ? h('textarea', {
              className: 'dsh-memory-textarea',
              value: props.editText,
              onChange: (event) => props.onEditText(event.target.value),
              rows: 3,
              autoFocus: true,
            })
          : h('p', { className: 'dsh-memory-text' }, memory.text),
        memory.explain !== undefined && memory.explain !== null
          ? h(
              'details',
              { className: 'dsh-memory-explain' },
              h('summary', null, t('Why this result', '为什么命中')),
              h(
                'div',
                { className: 'dsh-memory-explain-body' },
                ...explainLines(memory.explain, t).map((line, index) => h('div', { key: `explain-${index}` }, line)),
              ),
            )
          : null,
        memory.details?.admission?.reason !== undefined
          ? h('div', { className: 'dsh-memory-meta' }, h('span', null, `${t('admission', '准入')}: ${memory.details.admission.reason}`))
          : null,
        memory.details !== null && typeof memory.details === 'object' && (memory.details.symptom !== undefined || memory.details.fix !== undefined)
          ? h(
              'div',
              { className: 'dsh-memory-meta' },
              memory.details.symptom !== undefined ? h('span', null, `${t('symptom', '症状')}: ${memory.details.symptom}`) : null,
              memory.details.fix !== undefined ? h('span', null, `${t('fix', '修复')}: ${memory.details.fix}`) : null,
              memory.details.cause !== undefined ? h('span', null, `${t('cause', '原因')}: ${memory.details.cause}`) : null,
            )
          : null,
        h(
          'div',
          { className: 'dsh-memory-row-meta' },
          memory.match !== undefined ? h('span', null, `${t('match', '命中')} ${memory.match}`) : null,
          typeof memory.similarity === 'number' ? h('span', null, `${t('similarity', '相似度')} ${memory.similarity}`) : null,
          h('span', null, `${memory.tier ?? 'semantic'} · r${memory.revision ?? 1}`),
          (memory.useCount ?? 0) > 0 ? h('span', null, `${t('used', '使用')} ${memory.useCount}`) : null,
          (memory.helpfulCount ?? 0) > 0 ? h('span', null, `${t('helpful', '有用')} ${memory.helpfulCount}`) : null,
          h('span', null, `${t('updated', '更新')} ${formatAge(memory.ageDays)}`),
          h('span', { style: { opacity: 0.6 } }, memory.id),
          props.query !== undefined && String(props.query).trim() !== '' && mode === 'active'
            ? h(
                'span',
                { className: 'dsh-memory-feedback' },
                h('button', { type: 'button', onClick: () => props.onFeedback(memory.id, 'relevant') }, t('Relevant', '相关')),
                h('button', { type: 'button', onClick: () => props.onFeedback(memory.id, 'irrelevant') }, t('Irrelevant', '不相关')),
              )
            : null,
        ),
      )
    }

    function HistoryPanel(props) {
      const t = props.t
      return h(
        'div',
        { className: 'dsh-memory-history' },
        h(
          'div',
          { className: 'dsh-memory-row-top' },
          h('strong', null, t('Revision history', '修订历史')),
          h(
            'button',
            { type: 'button', className: 'dsh-memory-button', onClick: props.onClose },
            t('Close', '关闭'),
          ),
        ),
        props.items.length === 0
          ? h('div', { className: 'dsh-memory-meta' }, t('No revisions recorded.', '还没有修订记录。'))
          : props.items.map((revision) =>
              h(
                'div',
                { key: revision.seq ?? `${revision.revision}-${revision.action}`, className: 'dsh-memory-history-row' },
                h(
                  'div',
                  { className: 'dsh-memory-meta' },
                  h('span', null, `r${revision.revision} ${revision.action}/${revision.actor}`),
                  h('span', null, new Date(revision.createdAt).toLocaleString()),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-memory-button',
                      disabled: props.busy || props.diffBusy,
                      onClick: () => props.onDiff(revision.revision),
                    },
                    t('Diff vs current', '与当前对比'),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-memory-button',
                      disabled: props.busy,
                      onClick: () => props.onRollback(revision.revision),
                    },
                    t('Roll back', '回滚'),
                  ),
                ),
                revision.snapshot !== null && revision.snapshot !== undefined && typeof revision.snapshot.text === 'string'
                  ? h('div', { className: 'dsh-memory-history-text' }, revision.snapshot.text.slice(0, 180))
                  : null,
              ),
            ),
        props.diff !== null && props.diff !== undefined
          ? h(
              'div',
              { className: 'dsh-memory-diff' },
              h(
                'div',
                { className: 'dsh-memory-diff-field' },
                `diff r${props.diff.from.revision} → r${props.diff.to.revision}`,
              ),
              ...(props.diff.fields ?? []).map((field) =>
                h(
                  'div',
                  { key: `field-${field.field}`, className: 'dsh-memory-diff-field' },
                  `${field.field}: ${JSON.stringify(field.before)} → ${JSON.stringify(field.after)}`,
                ),
              ),
              ...(props.diff.lines ?? []).map((line, index) =>
                h(
                  'div',
                  {
                    key: `line-${index}`,
                    className: `dsh-memory-diff-line ${line.type === 'add' ? 'dsh-memory-diff-add' : line.type === 'del' ? 'dsh-memory-diff-del' : ''}`,
                  },
                  `${line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}${line.text}`,
                ),
              ),
            )
          : null,
      )
    }

    function MiniBars(props) {
      const values = Array.isArray(props.values) ? props.values : []
      const max = Math.max(1, ...values)
      const tone = props.tone ?? ''
      return h(
        'div',
        { className: 'dsh-memory-chart' },
        h('div', { className: 'dsh-memory-chart-title' }, props.title),
        h(
          'div',
          { className: 'dsh-memory-chart-bars' },
          ...values.map((value, index) =>
            h(
              'div',
              { key: `bar-${index}`, className: 'dsh-memory-chart-col', title: `${props.labels?.[index] ?? ''}: ${value}` },
              h('div', {
                className: `dsh-memory-chart-bar ${tone}`,
                style: { height: `${Math.max(2, Math.round((value / max) * 100))}%` },
              }),
            ),
          ),
        ),
        h(
          'div',
          { className: 'dsh-memory-chart-labels' },
          ...(props.labels ?? []).map((label, index) => h('span', { key: `label-${index}` }, String(label).slice(5))),
        ),
      )
    }

    function BudgetBar(props) {
      const max = props.max ?? 0
      const percent = max > 0 ? Math.min(100, Math.round((props.value / max) * 100)) : 0
      return h(
        'div',
        { className: 'dsh-memory-budget' },
        h(
          'div',
          { className: 'dsh-memory-budget-head' },
          h('span', null, props.label),
          h('span', null, `${props.value} / ${max}`),
        ),
        h(
          'div',
          { className: 'dsh-memory-progress' },
          h('div', { className: `dsh-memory-progress-fill${percent >= 80 ? ' warn' : ''}`, style: { width: `${percent}%` } }),
        ),
      )
    }

    function QualityChart(props) {
      const t = props.t
      const report = props.report
      const days = Array.isArray(report?.days) ? report.days : []
      const width = 600
      const height = 190
      const left = 30
      const right = 10
      const top = 12
      const bottom = 24
      const plotWidth = width - left - right
      const plotHeight = height - top - bottom
      const colorFor = (key) => (key === 'accuracy' ? 'var(--dsw-alias-brand-primary)' : key === 'effectiveness' ? 'var(--dsw-alias-state-success-primary, #2e7d32)' : 'var(--dsw-alias-label-tertiary)')
      const series = [
        ['accuracy', t('Accuracy', '准确率')],
        ['effectiveness', t('Effectiveness', '有效率')],
        ['coverage', t('Coverage', '覆盖率')],
      ]
      const xAt = (index) => left + (days.length <= 1 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth)
      const yAt = (value) => top + (1 - Math.max(0, Math.min(1, value))) * plotHeight
      return h(
        'div',
        { className: 'dsh-memory-line-chart' },
        h(
          'svg',
          { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': t('Recall quality trend', '召回质量趋势') },
          ...[0, 0.5, 1].map((value) =>
            h('g', { key: `grid-${value}` },
              h('line', { x1: left, y1: yAt(value), x2: left + plotWidth, y2: yAt(value), stroke: 'var(--dsw-alias-border-l1)', strokeWidth: 1, strokeDasharray: value === 0 || value === 1 ? undefined : '3 4' }),
              h('text', { x: 2, y: yAt(value) + 3, fill: 'var(--dsw-alias-label-tertiary)', fontSize: 9 }, `${Math.round(value * 100)}%`),
            ),
          ),
          ...series.map(([key, label]) => {
            const points = []
            days.forEach((day, index) => {
              const value = day[key]
              if (typeof value !== 'number') return
              points.push(`${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`)
            })
            return h(
              'g',
              { key },
              points.length > 1
                ? h('polyline', { points: points.join(' '), fill: 'none', stroke: colorFor(key), strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' })
                : null,
              ...days.map((day, index) => {
                const value = day[key]
                if (typeof value !== 'number') return null
                return h('circle', { key: `${key}-${day.day}`, cx: xAt(index), cy: yAt(value), r: 2.4, fill: colorFor(key) })
              }),
            )
          }),
          ...(days.length === 0
            ? [h('text', { x: width / 2, y: height / 2, textAnchor: 'middle', fill: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }, t('No rated recalls yet', '还没有评分数据'))]
            : []),
        ),
        h(
          'div',
          { className: 'dsh-memory-legend' },
          ...series.map(([key, label]) => h('span', { key }, h('i', { style: { background: colorFor(key) } }), label)),
        ),
      )
    }

    function DiagnosticsView(props) {
      const t = props.t
      const report = props.report
      if (report === null || report === undefined) {
        return h('div', { className: 'dsh-memory-loading' }, t('Loading diagnostics…', '加载诊断中…'))
      }
      const trend = Array.isArray(report.trend) ? report.trend : []
      const labels = trend.map((day) => day.day)
      const counts = report.counts ?? {}
      const lastRuns = Object.entries(report.events?.lastRuns ?? {})
      return h(
        'div',
        { className: 'dsh-memory-diagnostics' },
        h(
          'div',
          { className: 'dsh-memory-actions-row' },
          h('button', { type: 'button', className: 'dsh-memory-button', disabled: props.busy, onClick: props.onRefresh }, t('Refresh', '刷新')),
          h('button', { type: 'button', className: 'dsh-memory-button', disabled: props.busy, onClick: props.onExport }, t('Export diagnostics JSON', '导出诊断 JSON')),
          h('button', { type: 'button', className: 'dsh-memory-button', disabled: props.busy, onClick: props.onBackup }, t('Back up now', '立即备份')),
          h('button', { type: 'button', className: 'dsh-memory-button', disabled: props.busy, onClick: props.onConsolidate }, t('Consolidate', '整理')),
        ),
        props.notice !== null ? h('div', { className: 'dsh-memory-banner ok' }, props.notice) : null,
        ...(report.warnings ?? []).map((warning, index) =>
          h('div', { key: `warning-${index}`, className: `dsh-memory-warning-card ${warning.level}` }, `${warning.level.toUpperCase()}: ${warning.message}`),
        ),
        h(
          'div',
          null,
          h(
            'div',
            { className: 'dsh-memory-actions-row', style: { justifyContent: 'space-between' } },
            h('div', { className: 'dsh-memory-section-title' }, t('Recall quality', '召回质量')),
            h(
              'div',
              { className: 'dsh-memory-actions-row' },
              ...[7, 30, 90].map((days) =>
                h(
                  'button',
                  {
                    key: days,
                    type: 'button',
                    className: `dsh-memory-tab${props.qualityDays === days ? ' selected' : ''}`,
                    onClick: () => props.onQualityRange(days),
                  },
                  `${days}d`,
                ),
              ),
            ),
          ),
          props.quality === null || props.quality === undefined
            ? h('div', { className: 'dsh-memory-hint' }, t('Loading recall quality…', '加载召回质量中…'))
            : h(
                React.Fragment,
                null,
                h(QualityChart, { report: props.quality, t }),
                h(
                  'div',
                  { className: 'dsh-memory-kpis', style: { marginTop: '8px' } },
                  ...[
                    [t('Accuracy', '准确率'), props.quality.totals?.accuracy],
                    [t('Effectiveness', '有效率'), props.quality.totals?.effectiveness],
                    [t('Coverage', '覆盖率'), props.quality.totals?.coverage],
                    [t('Outdated', '过时率'), props.quality.totals?.outdatedRate],
                    [t('Ratings', '评分数'), props.quality.totals?.explicitRatings],
                    [t('MQI', '综合指数'), props.quality.totals?.mqi],
                  ].map(([label, value]) =>
                    h(
                      'div',
                      { key: String(label), className: 'dsh-memory-kpi' },
                      h('span', { className: 'dsh-memory-kpi-label' }, label),
                      h(
                        'span',
                        { className: 'dsh-memory-kpi-value', style: { fontSize: '16px' } },
                        typeof value === 'number' ? (label === 'Ratings' || label === '评分数' || label === 'MQI' || label === '综合指数' ? String(Math.round(value * 100) / 100) : `${Math.round(value * 100)}%`) : '—',
                      ),
                    ),
                  ),
                ),
                props.quality.sampleNote !== null && props.quality.sampleNote !== undefined
                  ? h('div', { className: 'dsh-memory-hint' }, props.quality.sampleNote)
                  : null,
                ...(props.quality.suggestions ?? []).map((suggestion, index) =>
                  h('div', { key: `quality-suggestion-${index}`, className: `dsh-memory-warning-card ${suggestion.level}` }, suggestion.message),
                ),
                ...(props.quality.staleMemories ?? []).slice(0, 5).map((memory) =>
                  h(
                    'div',
                    { key: memory.id, className: 'dsh-memory-run-row' },
                    h('strong', null, memory.kind ?? 'memory'),
                    h('span', null, `${memory.votes} × outdated`),
                    h('span', null, memory.text ?? memory.id),
                  ),
                ),
              ),
        ),
        h(
          'div',
          { className: 'dsh-memory-kpis' },
          ...[
            [t('Active', '生效'), counts.active ?? 0],
            [t('Needs review', '待复核'), counts.review ?? 0],
            [t('Conflicts', '冲突'), counts.conflict ?? 0],
            [t('Pending', '待确认'), counts.candidate ?? 0],
            [t('Archived', '归档'), counts.archived ?? 0],
            [t('Superseded', '被取代'), counts.superseded ?? 0],
            [t('Revisions', '修订'), report.revisions ?? 0],
            [t('Events', '事件'), report.events?.total ?? 0],
            [t('Digest queue', '摘要队列'), report.queues?.digestQueue ?? 0],
            [t('Pending vectors', '待补向量'), report.pendingEmbeddings ?? 0],
            [t('DB size', '库大小'), `${Math.round((report.storage?.dbBytes ?? 0) / 1024)} KB`],
            [t('Backups', '备份'), report.backups?.count ?? 0],
          ].map(([label, value]) =>
            h('div', { key: String(label), className: 'dsh-memory-kpi' }, h('span', { className: 'dsh-memory-kpi-label' }, label), h('span', { className: 'dsh-memory-kpi-value' }, String(value))),
          ),
        ),
        h(
          'div',
          { className: 'dsh-memory-chart-grid' },
          h(MiniBars, { title: t('Extraction runs', '抽取运行'), values: trend.map((day) => day.extract ?? 0), labels }),
          h(MiniBars, { title: t('Admission runs', '准入运行'), values: trend.map((day) => day.admission ?? 0), labels }),
          h(MiniBars, { title: t('Retrieval calls', '检索调用'), values: trend.map((day) => day.retrieval ?? 0), labels }),
          h(MiniBars, { title: t('Errors', '错误'), values: trend.map((day) => day.errors ?? 0), labels, tone: 'bad' }),
          h(MiniBars, { title: t('Relevant feedback', '相关反馈'), values: trend.map((day) => day.relevant ?? 0), labels, tone: 'good' }),
          h(MiniBars, { title: t('Irrelevant feedback', '不相关反馈'), values: trend.map((day) => day.irrelevant ?? 0), labels, tone: 'warn' }),
        ),
        h(
          'div',
          { className: 'dsh-memory-kpis' },
          h(
            'div',
            { className: 'dsh-memory-kpi' },
            h('span', { className: 'dsh-memory-kpi-label' }, t('Embedder', '嵌入服务')),
            h('span', { className: 'dsh-memory-kpi-value' }, report.embedder?.ok === true ? `${report.embedder.latencyMs} ms` : t('down', '不可用')),
          ),
          h(
            'div',
            { className: 'dsh-memory-kpi' },
            h('span', { className: 'dsh-memory-kpi-label' }, t('Capture mode', '捕获模式')),
            h('span', { className: 'dsh-memory-kpi-value' }, report.config?.captureMode ?? '-'),
          ),
          h(
            'div',
            { className: 'dsh-memory-kpi' },
            h('span', { className: 'dsh-memory-kpi-label' }, t('Admission', '自动准入')),
            h('span', { className: 'dsh-memory-kpi-value' }, report.config?.admissionEnabled === true ? t('on', '开') : t('off', '关')),
          ),
          h(
            'div',
            { className: 'dsh-memory-kpi' },
            h('span', { className: 'dsh-memory-kpi-label' }, t('Latest backup', '最新备份')),
            h('span', { className: 'dsh-memory-kpi-value', style: { fontSize: '12px', fontWeight: 500 } }, report.backups?.newest ? new Date(report.backups.newest.createdAt).toLocaleDateString() : t('none', '无')),
          ),
        ),
        h(
          'div',
          { className: 'dsh-memory-chart' },
          h('div', { className: 'dsh-memory-chart-title' }, t('Daily budget', '每日预算')),
          h(BudgetBar, { label: t('calls', '调用次数'), value: report.budget?.calls ?? 0, max: report.budget?.limits?.maxExtractionsPerDay ?? 0 }),
          h(BudgetBar, { label: t('tokens', 'tokens'), value: report.budget?.tokens ?? 0, max: report.budget?.limits?.dailyTokenBudget ?? 0 }),
        ),
        lastRuns.length > 0
          ? h(
              'div',
              null,
              h('div', { className: 'dsh-memory-section-title' }, t('Latest runs', '最近运行')),
              ...lastRuns.map(([kind, run]) =>
                h(
                  'div',
                  { key: `run-${kind}`, className: 'dsh-memory-run-row' },
                  h('strong', null, kind),
                  h('span', null, run.status),
                  run.durationMs !== null ? h('span', null, `${run.durationMs}ms`) : null,
                  h('span', null, new Date(run.at).toLocaleString()),
                  run.error ? h('span', { className: 'dsh-memory-warning error' }, run.error) : null,
                ),
              ),
            )
          : null,
        (props.events ?? []).length > 0
          ? h(
              'div',
              null,
              h('div', { className: 'dsh-memory-section-title' }, t('Recent events', '最近事件')),
              ...(props.events ?? []).slice(0, 12).map((event, index) =>
                h(
                  'div',
                  { key: `event-${event.seq ?? index}`, className: 'dsh-memory-run-row' },
                  h('strong', null, event.kind),
                  h('span', null, event.status),
                  event.count !== null ? h('span', null, `×${event.count}`) : null,
                  event.durationMs !== null ? h('span', null, `${event.durationMs}ms`) : null,
                  h('span', null, new Date(event.at).toLocaleTimeString()),
                  event.error ? h('span', { className: 'dsh-memory-warning error' }, event.error) : null,
                ),
              ),
            )
          : null,
      )
    }

    function MemoryBrowser(props) {
      const client = props.client
      const t = props.t
      const [stats, setStats] = useState(null)
      const [items, setItems] = useState([])
      const [total, setTotal] = useState(0)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [query, setQuery] = useState('')
      const [scope, setScope] = useState('')
      const [kind, setKind] = useState('')
      const [draftText, setDraftText] = useState('')
      const [draftKind, setDraftKind] = useState('other')
      const [draftScope, setDraftScope] = useState('')
      const [draftImportance, setDraftImportance] = useState('3')
      const [draftValidUntil, setDraftValidUntil] = useState('')
      const [saving, setSaving] = useState(false)
      const [editingId, setEditingId] = useState(null)
      const [editText, setEditText] = useState('')
      const [confirmingId, setConfirmingId] = useState(null)
      const [busyId, setBusyId] = useState(null)
      const [tab, setTab] = useState('active')
      const [projects, setProjects] = useState([])
      const [conflicts, setConflicts] = useState([])
      const [notice, setNotice] = useState(null)
      const [offset, setOffset] = useState(0)
      const [hasMore, setHasMore] = useState(false)
      const [showAddForm, setShowAddForm] = useState(false)
      const [historyId, setHistoryId] = useState(null)
      const [historyItems, setHistoryItems] = useState([])
      const [historyBusy, setHistoryBusy] = useState(false)
      const [diffData, setDiffData] = useState(null)
      const [diffBusy, setDiffBusy] = useState(false)
      const [diagnostics, setDiagnostics] = useState(null)
      const [eventList, setEventList] = useState([])
      const [quality, setQuality] = useState(null)
      const [qualityDays, setQualityDays] = useState(7)
      const [diagBusy, setDiagBusy] = useState(false)
      const [diagNotice, setDiagNotice] = useState(null)
      const [loadingMore, setLoadingMore] = useState(false)
      const loadingMoreRef = useRef(false)
      const requestRef = useRef(0)

      async function refresh() {
        const requestId = ++requestRef.current
        setLoading(true)
        setError(null)
        try {
          const filters = {
            scope: scope === '' ? undefined : scope,
            kind: kind === '' ? undefined : kind,
            limit: 50,
            offset: 0,
          }
          if (tab === 'diagnostics') {
            const [nextDiagnostics, nextEvents, nextStats, nextQuality] = await Promise.all([
              client.diagnostics(),
              client.events(20).catch(() => []),
              client.stats(),
              client.quality(qualityDays).catch(() => null),
            ])
            if (requestId !== requestRef.current) return
            setDiagnostics(nextDiagnostics)
            setEventList(Array.isArray(nextEvents) ? nextEvents : [])
            setQuality(nextQuality ?? null)
            setItems([])
            setTotal(0)
            setOffset(0)
            setHasMore(false)
            setStats(nextStats)
            return
          }
          if (tab === 'projects') {
            const [nextProjects, nextStats] = await Promise.all([client.projects(), client.stats()])
            if (requestId !== requestRef.current) return
            setProjects(Array.isArray(nextProjects) ? nextProjects : [])
            setItems([])
            setTotal(Array.isArray(nextProjects) ? nextProjects.length : 0)
            setOffset(0)
            setHasMore(false)
            setStats(nextStats)
            return
          }
          if (tab === 'review') {
            const [nextReviews, nextConflicts, nextStats] = await Promise.all([
              client.reviewQueue(100, 0),
              client.conflicts().catch(() => []),
              client.stats(),
            ])
            if (requestId !== requestRef.current) return
            const reviews = Array.isArray(nextReviews) ? nextReviews : []
            setItems(reviews)
            setConflicts(Array.isArray(nextConflicts) ? nextConflicts : [])
            setTotal(reviews.length)
            setOffset(reviews.length)
            setHasMore(reviews.length >= 100)
            setStats(nextStats)
            return
          }
          const request =
            tab === 'active'
              ? query.trim() === ''
                ? client.list(filters)
                : client.search({ ...filters, query: query.trim(), limit: 10, explain: true })
              : client.candidates({ limit: 50, offset: 0, status: tab })
          const [page, nextStats] = await Promise.all([request, client.stats()])
          if (requestId !== requestRef.current) return
          const pageMemories = Array.isArray(page.memories) ? page.memories : []
          const pageTotal = typeof page.total === 'number' ? page.total : pageMemories.length
          setItems(pageMemories)
          setTotal(pageTotal)
          setOffset(pageMemories.length)
          setHasMore((tab === 'active' ? query.trim() === '' : true) && pageMemories.length < pageTotal)
          setStats(nextStats)
          if (page.degraded === true) {
            setError(page.degradedReason ? `${t('Retrieval degraded: ', '检索降级：')}${page.degradedReason}` : null)
          }
        } catch (failure) {
          if (requestId === requestRef.current) setError(errorText(failure))
        } finally {
          if (requestId === requestRef.current) setLoading(false)
        }
      }

      async function loadMore() {
        if (loadingMoreRef.current || !hasMore || tab === 'projects' || tab === 'diagnostics') return
        if (tab === 'active' && query.trim() !== '') return
        loadingMoreRef.current = true
        setLoadingMore(true)
        setError(null)
        try {
          const filters = {
            scope: scope === '' ? undefined : scope,
            kind: kind === '' ? undefined : kind,
            limit: 50,
            offset,
          }
          const page =
            tab === 'active'
              ? await client.list(filters)
              : tab === 'review'
                ? null
                : await client.candidates({ limit: 50, offset, status: tab })
          const pageMemories = tab === 'review'
            ? await client.reviewQueue(100, offset)
            : Array.isArray(page.memories) ? page.memories : []
          const next = pageMemories
          const nextOffset = offset + next.length
          setItems((current) => [...current, ...next])
          setOffset(nextOffset)
          setHasMore(tab === 'review' ? next.length >= 100 : nextOffset < (typeof page.total === 'number' ? page.total : nextOffset))
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          loadingMoreRef.current = false
          setLoadingMore(false)
        }
      }

      function handleScroll(event) {
        const element = event.currentTarget
        if (element.scrollHeight - element.scrollTop - element.clientHeight < 240) void loadMore()
      }

      useEffect(() => {
        void refresh()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [scope, kind, tab, qualityDays])

      async function submitSearch(event) {
        event?.preventDefault?.()
        await refresh()
      }

      async function saveDraft() {
        if (draftText.trim() === '') return
        setSaving(true)
        setError(null)
        try {
          await client.save({
            text: draftText.trim(),
            kind: draftKind,
            scope: draftScope === '' ? undefined : draftScope,
            importance: Number.parseInt(draftImportance, 10),
            validUntil: draftValidUntil === '' ? undefined : new Date(`${draftValidUntil}T23:59:59`).getTime(),
          })
          setDraftText('')
          setDraftValidUntil('')
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setSaving(false)
        }
      }

      async function saveEdit(id) {
        if (editText.trim() === '') return
        setBusyId(id)
        setError(null)
        try {
          await client.update({ id, text: editText.trim() })
          setEditingId(null)
          setEditText('')
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusyId(null)
        }
      }

      async function confirmCandidate(id) {
        setBusyId(id)
        setError(null)
        try {
          await client.confirmCandidate({ id })
          setNotice(t('Accepted into active memory.', '已接受为正式记忆。'))
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusyId(null)
        }
      }

      async function dismissCandidate(id) {
        setBusyId(id)
        setError(null)
        try {
          await client.dismissCandidate({ id })
          setNotice(t('Dismissed.', '已忽略。'))
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusyId(null)
        }
      }

      async function archiveMemory(id) {
        setBusyId(id)
        setError(null)
        try {
          await client.archive(id)
          setNotice(t('Archived.', '已归档。'))
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusyId(null)
        }
      }

      async function resolveConflict(id, resolution) {
        setBusyId(id)
        setError(null)
        try {
          await client.resolveConflict(id, resolution)
          setNotice(t('Conflict resolved.', '冲突已处理。'))
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusyId(null)
        }
      }

      async function keepReview(id) {
        setBusyId(id)
        setError(null)
        try {
          await client.keepReview(id)
          setNotice(t('Marked as still valid and removed from review.', '已标记为仍然有效，移出待复核。'))
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusyId(null)
        }
      }

      async function restoreMemory(id) {
        setBusyId(id)
        setError(null)
        try {
          await client.restore(id)
          setNotice(t('Restored to active memory.', '已恢复为正式记忆。'))
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusyId(null)
        }
      }

      async function sendFeedback(id, action) {
        setNotice(null)
        try {
          await client.feedback(id, action, query)
          setNotice(`${t('Feedback recorded', '反馈已记录')}: ${action}`)
        } catch (failure) {
          setError(errorText(failure))
        }
      }

      async function refreshDiagnostics() {
        setDiagBusy(true)
        setError(null)
        setDiagNotice(null)
        try {
          const [report, events] = await Promise.all([client.diagnostics(), client.events(20)])
          setDiagnostics(report)
          setEventList(Array.isArray(events) ? events : [])
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setDiagBusy(false)
        }
      }

      async function exportDiagnosticsFile() {
        setDiagBusy(true)
        setError(null)
        setDiagNotice(null)
        try {
          const result = await client.exportDiagnostics()
          setDiagNotice(`${t('Diagnostics written to', '诊断包已写入')} ${result.path}`)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setDiagBusy(false)
        }
      }

      async function backupFromDiagnostics() {
        setDiagBusy(true)
        setError(null)
        setDiagNotice(null)
        try {
          const result = await client.createBackup('manual')
          setDiagNotice(`${t('Backup created', '备份已创建')}: ${result.name}`)
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setDiagBusy(false)
        }
      }

      async function consolidateFromDiagnostics() {
        setDiagBusy(true)
        setError(null)
        setDiagNotice(null)
        try {
          const result = await client.consolidateNow()
          if (result?.skipped) setDiagNotice(`${t('Consolidation skipped', '整理跳过')}: ${result.reason ?? 'unavailable'}`)
          else setDiagNotice(`${t('Consolidated', '整理完成')}: ${result.merged ?? 0} merged / ${result.archived ?? 0} archived`)
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setDiagBusy(false)
        }
      }

      async function runExtraction() {
        setError(null)
        setNotice(t('Extracting…', '抽取中…'))
        try {
          const result = await client.extractNow()
          setNotice(
            `${t('Extraction', '抽取')}: ${result?.candidates ?? 0} ${t('candidate(s)', '条候选')}` +
              (result?.summaries ? `, ${result.summaries} ${t('digest(s)', '条摘要')}` : ''),
          )
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        }
      }

      async function runPreview() {
        setError(null)
        setNotice(t('Running a dry extraction…', '试跑抽取中…'))
        try {
          const result = await client.previewExtraction({})
          if (result === undefined || result.skipped === true) {
            setNotice(`${t('Dry run skipped', '试跑跳过')}: ${result?.reason ?? 'unavailable'}`)
            return
          }
          const items = Array.isArray(result.items) ? result.items : []
          const first = items[0]
          setNotice(
            `${t('Dry run', '试跑')}: ${items.length} ${t('item(s)', '条')} · ${result.transcriptChars ?? 0} chars · ${result.elapsedMs ?? 0}ms` +
              (first ? ` — ${String(first.text).slice(0, 120)}` : ''),
          )
        } catch (failure) {
          setError(errorText(failure))
        }
      }

      async function runAdmission() {
        setError(null)
        setNotice(t('Running the admission judge…', '自动准入判定中…'))
        try {
          const result = await client.admitNow()
          if (result === undefined || result.skipped === true) {
            setNotice(`${t('Admission skipped', '准入跳过')}: ${result?.reason ?? result?.skipped}`);
            return
          }
          setNotice(
            `${t('Admission', '准入')}: +${result.added ?? 0} add / ~${result.updated ?? 0} update / -${result.skipped ?? 0} skip` +
              (result.invalid ? ` / ${result.invalid} invalid` : ''),
          )
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        }
      }

      async function loadHistory(id) {
        setHistoryBusy(true)
        setError(null)
        try {
          const result = await client.history(id, 20)
          setHistoryItems(Array.isArray(result?.revisions) ? result.revisions : [])
          setHistoryId(id)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setHistoryBusy(false)
        }
      }

      async function toggleHistory(id) {
        if (historyId === id) {
          setHistoryId(null)
          setHistoryItems([])
          setDiffData(null)
          return
        }
        setDiffData(null)
        await loadHistory(id)
      }

      async function showDiff(id, revision) {
        setDiffBusy(true)
        setError(null)
        try {
          const diff = await client.diffRevisions(id, revision, null)
          setDiffData(diff)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setDiffBusy(false)
        }
      }

      async function rollbackMemory(id, revision) {
        setHistoryBusy(true)
        setError(null)
        try {
          await client.rollback(id, revision)
          setNotice(`${t('Rolled back to revision', '已回滚到修订')} r${revision}`)
          await refresh()
          await loadHistory(id)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setHistoryBusy(false)
        }
      }

      async function runConsolidate() {
        setError(null)
        setNotice(t('Consolidating…', '整理中…'))
        try {
          const result = await client.consolidateNow()
          if (result === undefined || result.skipped === true) {
            setNotice(`${t('Consolidation skipped', '整理跳过')}: ${result?.reason ?? 'unavailable'}`)
            return
          }
          setNotice(`${t('Consolidated', '整理完成')}: ${result.merged ?? 0} ${t('merged', '条合并')} / ${result.archived ?? 0} ${t('archived', '条归档')}`)
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        }
      }

      async function remove(id) {
        setBusyId(id)
        setError(null)
        try {
          await client.remove({ id })
          setConfirmingId(null)
          await refresh()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBusyId(null)
        }
      }

      const subtitle =
        stats === null
          ? t('Loading…', '加载中…')
          : `${stats.count} ${t('memories', '条记忆')} · ${stats.pendingEmbeddings} ${t('pending embeddings', '条待补向量')} · ${stats.embedding.model} (${stats.embedding.dimensions}d)`

      return h(
        'div',
        { className: 'dsh-memory-main' },
        h('style', null, PAGE_CSS),
        h(
          'div',
          { className: 'dsh-memory-scroll', onScroll: handleScroll },
          h(
            'div',
            { className: 'dsh-memory-page' },
        h(
          'div',
          { className: 'dsh-memory-header' },
          h(
            'div',
            { className: 'dsh-memory-header-text' },
            h('h2', { className: 'dsh-memory-title' }, t('Memory', '记忆')),
            h('div', { className: 'dsh-memory-subtitle' }, subtitle),
          ),
          h(
            'details',
            { className: 'dsh-memory-menu' },
            h('summary', { className: 'dsh-memory-button' }, t('Maintenance', '维护')),
            h(
              'div',
              { className: 'dsh-memory-menu-panel' },
              h('button', { type: 'button', className: 'dsh-memory-menu-item', onClick: (event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void runExtraction() } }, t('Extract now', '立即抽取'), h('small', null, t('scan dirty project sessions', '扫描待抽取的项目会话'))),
              h('button', { type: 'button', className: 'dsh-memory-menu-item', onClick: (event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void runPreview() } }, t('Dry run extraction', '试跑抽取'), h('small', null, t('preview without writing candidates', '只预览，不写候选'))),
              h('button', { type: 'button', className: 'dsh-memory-menu-item', onClick: (event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void runAdmission() } }, t('Run admission', '运行自动准入'), h('small', null, t('let the model admit pending candidates', '让模型判断待确认候选'))),
              h('button', { type: 'button', className: 'dsh-memory-menu-item', onClick: (event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void runConsolidate() } }, t('Consolidate', '整理记忆'), h('small', null, t('merge near-duplicates, archive stale', '合并近重复、归档低价值旧记忆'))),
            ),
          ),
        ),
        error !== null ? h('div', { className: 'dsh-memory-banner error' }, error) : null,
        notice !== null ? h('div', { className: 'dsh-memory-banner ok' }, notice) : null,
        h(
          'div',
          { className: 'dsh-memory-tabs' },
          ...[
            ['active', t('Saved', '已保存'), stats?.activeCount],
            ['review', t('Review', '复核'), stats?.reviewCount],
            ['candidate', t('Pending', '待确认'), stats?.candidateCount],
            ['closed', t('Archive', '归档'), (stats?.dismissedCount ?? 0) + (stats?.archivedCount ?? 0) + (stats?.supersededCount ?? 0)],
            ['projects', t('Projects', '项目'), undefined],
            ['diagnostics', t('Diagnostics', '诊断'), undefined],
          ].map(([key, label, count]) =>
            h(
              'button',
              {
                key,
                type: 'button',
                className: `dsh-memory-tab${tab === key ? ' selected' : ''}`,
                onClick: () => {
                  setNotice(null)
                  setTab(key)
                },
              },
              `${label}${typeof count === 'number' ? ` ${count}` : ''}`,
            ),
          ),
        ),
        tab === 'review' && conflicts.length > 0
          ? h(
              'div',
              { className: 'dsh-memory-conflicts' },
              h('div', { className: 'dsh-memory-section-title' }, `${t('Possible conflicts', '可能冲突')} (${conflicts.length})`),
              ...conflicts.map((conflict) =>
                h(
                  'div',
                  { key: conflict.id, className: 'dsh-memory-conflict-card' },
                  h(
                    'div',
                    { className: 'dsh-memory-conflict-side' },
                    h('div', { className: 'dsh-memory-meta' },
                      `${t('older', '旧')} · ${conflict.old?.kind ?? 'memory'} · ${conflict.detail?.relation ?? t('similar', '相似')}`
                      + (typeof conflict.detail?.confidence === 'number' ? ` ${Math.round(conflict.detail.confidence * 100)}%` : ` · ${conflict.similarity ?? '-'}`)),
                    h('p', { className: 'dsh-memory-text' }, conflict.old?.text ?? conflict.oldId),
                  ),
                  h(
                    'div',
                    { className: 'dsh-memory-conflict-side' },
                    h('div', { className: 'dsh-memory-meta' }, `${t('newer', '新')} · ${conflict.new?.kind ?? 'memory'}`),
                    h('p', { className: 'dsh-memory-text' }, conflict.new?.text ?? conflict.newId),
                  ),
                  conflict.detail?.reason ? h('div', { className: 'dsh-memory-hint' }, `${t('why', '判断依据')}: ${conflict.detail.reason}`) : null,
                  conflict.detail?.evidence ? h('div', { className: 'dsh-memory-hint' }, `${t('evidence', '证据')}: ${conflict.detail.evidence}`) : null,
                  h(
                    'div',
                    { className: 'dsh-memory-actions-row' },
                    h('button', { type: 'button', className: 'dsh-memory-button primary', disabled: busyId === conflict.id, onClick: () => void resolveConflict(conflict.id, 'supersede') }, t('Replace older', '用新记忆替换旧记忆')),
                    h('button', { type: 'button', className: 'dsh-memory-button', disabled: busyId === conflict.id, onClick: () => void resolveConflict(conflict.id, 'keep') }, t('Keep both', '保留两条')),
                    h('button', { type: 'button', className: 'dsh-memory-button', disabled: busyId === conflict.id, onClick: () => void resolveConflict(conflict.id, 'dismiss') }, t('Ignore', '忽略')),
                  ),
                ),
              ),
            )
          : null,
        tab !== 'active' ? null : h(
          'div',
          { className: 'dsh-memory-search-row' },
          h('input', {
            className: 'dsh-memory-input',
            value: query,
            placeholder: t('Search memories (hybrid semantic + keyword)…', '搜索记忆（语义 + 关键词混合检索）…'),
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') void refresh()
            },
          }),
          h(
            'select',
            { className: 'dsh-memory-select', value: scope, onChange: (event) => setScope(event.target.value) },
            h('option', { value: '' }, t('All scopes', '全部作用域')),
            ...SCOPES.map((item) => h('option', { key: item, value: item }, labelOf(SCOPE_LABELS, item, t))),
          ),
          h(
            'select',
            { className: 'dsh-memory-select', value: kind, onChange: (event) => setKind(event.target.value) },
            h('option', { value: '' }, t('All kinds', '全部类别')),
            ...KINDS.map((item) => h('option', { key: item, value: item }, labelOf(KIND_LABELS, item, t))),
          ),
          h('button', { type: 'button', className: 'dsh-memory-button', onClick: () => void refresh() }, t('Search', '搜索')),
          h(
            'button',
            {
              type: 'button',
              className: `dsh-memory-button${showAddForm ? ' primary' : ''}`,
              onClick: () => setShowAddForm((current) => !current),
            },
            showAddForm ? t('Close', '收起') : t('+ Add', '＋ 添加'),
          ),
        ),
        tab === 'active' && showAddForm ? h(
          'div',
          { className: 'dsh-memory-form' },
          h('textarea', {
            className: 'dsh-memory-textarea',
            value: draftText,
            placeholder: t('Add a memory: one self-contained sentence…', '新增记忆：一句话、自包含…'),
            onChange: (event) => setDraftText(event.target.value),
            rows: 2,
            autoFocus: true,
          }),
          h(
            'div',
            { className: 'dsh-memory-form-row' },
            h(
              'select',
              { className: 'dsh-memory-select', value: draftKind, onChange: (event) => setDraftKind(event.target.value) },
              ...KINDS.map((item) => h('option', { key: item, value: item }, labelOf(KIND_LABELS, item, t))),
            ),
            h(
              'select',
              { className: 'dsh-memory-select', value: draftScope, onChange: (event) => setDraftScope(event.target.value) },
              h('option', { value: '' }, t('Auto scope', '自动作用域')),
              ...SCOPES.map((item) => h('option', { key: item, value: item }, labelOf(SCOPE_LABELS, item, t))),
            ),
            h(
              'select',
              { className: 'dsh-memory-select', value: draftImportance, onChange: (event) => setDraftImportance(event.target.value) },
              ...[1, 2, 3, 4, 5].map((value) => h('option', { key: value, value: String(value) }, `${t('importance', '重要度')} ${value}`)),
            ),
            h('input', {
              className: 'dsh-memory-input',
              type: 'date',
              title: t('Optional expiration', '可选有效期'),
              value: draftValidUntil,
              onChange: (event) => setDraftValidUntil(event.target.value),
            }),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-memory-button primary',
                disabled: saving || draftText.trim() === '',
                onClick: () => void saveDraft(),
              },
              saving ? t('Saving…', '保存中…') : t('Remember', '记住'),
            ),
          ),
        ) : null,
        tab === 'diagnostics'
          ? h(DiagnosticsView, {
              report: diagnostics,
              events: eventList,
              quality,
              qualityDays,
              onQualityRange: setQualityDays,
              t,
              busy: diagBusy,
              notice: diagNotice,
              onRefresh: () => void refreshDiagnostics(),
              onExport: () => void exportDiagnosticsFile(),
              onBackup: () => void backupFromDiagnostics(),
              onConsolidate: () => void consolidateFromDiagnostics(),
            })
          : tab === 'projects'
          ? projects.length === 0
            ? h('div', { className: 'dsh-memory-empty' }, t('No project memories yet.', '还没有项目记忆。'))
            : h(
                'div',
                { className: 'dsh-memory-list' },
                ...projects.map((project) =>
                  h(
                    'div',
                    { key: project.project, className: 'dsh-memory-project' },
                    h('div', { className: 'dsh-memory-project-title' }, project.project),
                    h(
                      'div',
                      { className: 'dsh-memory-meta' },
                      h('span', null, `${project.count} ${t('memories', '条记忆')}`),
                      h('span', null, `${t('updated', '更新')} ${formatAge((Date.now() - project.lastUpdatedAt) / 86400000)}`),
                    ),
                    project.digest !== null
                      ? h(
                          'div',
                          { className: 'dsh-memory-project-section' },
                          h('div', { className: 'dsh-memory-project-label' }, t('Project digest', '项目摘要')),
                          h('p', { className: 'dsh-memory-text' }, project.digest.text),
                        )
                      : null,
                    project.pitfalls.length > 0
                      ? h(
                          'div',
                          { className: 'dsh-memory-project-section' },
                          h('div', { className: 'dsh-memory-project-label' }, `${t('Known pitfalls', '已知坑')} (${project.pitfalls.length})`),
                          ...project.pitfalls.map((pitfall) =>
                            h(
                              'p',
                              { key: pitfall.id, className: 'dsh-memory-text' },
                              `• ${pitfall.details?.symptom ? `${t('symptom', '症状')}: ${pitfall.details.symptom} — ` : ''}${pitfall.text}`,
                            ),
                          ),
                        )
                      : null,
                  ),
                ),
              )
          : loading && items.length === 0
          ? h('div', { className: 'dsh-memory-loading' }, t('Loading memories…', '加载记忆中…'))
          : items.length === 0 && conflicts.length === 0
            ? h(
                'div',
                { className: 'dsh-memory-empty' },
                tab === 'review'
                  ? t('Nothing needs review. Outdated or repeatedly irrelevant memories will appear here.', '没有需要复核的记忆。过时或多次不相关的记忆会出现在这里。')
                  : t('No memories yet. Save one above, or ask the agent to remember something.', '还没有记忆。可以在上方新增，或让助手记住一些事情。'),
              )
            : h(
                'div',
                { className: 'dsh-memory-list' },
                ...items.map((memory) =>
                  h(
                    React.Fragment,
                    { key: memory.id },
                    h(MemoryRow, {
                    key: memory.id,
                    memory,
                    t,
                    mode: tab,
                    editingId,
                    editText,
                    confirmingId,
                    busyId,
                    onStartEdit: (target) => {
                      setEditingId(target.id)
                      setEditText(target.text)
                      setConfirmingId(null)
                    },
                    onCancelEdit: () => {
                      setEditingId(null)
                      setEditText('')
                    },
                    onEditText: setEditText,
                    onSaveEdit: (id, text) => void saveEdit(id),
                    onAskDelete: (id) => {
                      setConfirmingId(id)
                      setEditingId(null)
                    },
                    onCancelDelete: () => setConfirmingId(null),
                    onDelete: (id) => void remove(id),
                    onConfirm: (id) => void confirmCandidate(id),
                    onDismiss: (id) => void dismissCandidate(id),
                    onRestore: (id) => void restoreMemory(id),
                    onArchive: (id) => void archiveMemory(id),
                    onKeep: (id) => void keepReview(id),
                    onHistory: (id) => void toggleHistory(id),
                    onFeedback: (id, action) => void sendFeedback(id, action),
                    query,
                  }),
                  historyId === memory.id
                    ? h(HistoryPanel, {
                        key: `${memory.id}-history`,
                        t,
                        items: historyItems,
                        busy: historyBusy,
                        diff: diffData,
                        diffBusy,
                        onDiff: (revision) => void showDiff(memory.id, revision),
                        onRollback: (revision) => void rollbackMemory(memory.id, revision),
                        onClose: () => {
                          setHistoryId(null)
                          setHistoryItems([])
                          setDiffData(null)
                        },
                      })
                    : null,
                  ),
                ),
              ),
        tab === 'diagnostics' ? null : h(
          'div',
          { className: 'dsh-memory-meta' },
          h('span', null, `${items.length} / ${total} ${t('shown', '显示')}`),
          typeof stats?.candidateCount === 'number' && stats.candidateCount > 0 && tab === 'active'
            ? h('span', null, `${stats.candidateCount} ${t('candidates awaiting review', '条候选待确认')}`)
            : null,
          typeof stats?.reviewCount === 'number' && stats.reviewCount > 0 && tab !== 'review'
            ? h('span', null, `${stats.reviewCount} ${t('memories need review', '条记忆待复核')}`)
            : null,
          stats !== null && stats.embedder !== undefined && stats.embedder.ok === true
            ? h('span', null, `embedder ${stats.embedder.latencyMs}ms`)
            : null,
        ),
        tab !== 'diagnostics' && hasMore
          ? h(
              'div',
              { className: 'dsh-memory-loadmore' },
              h(
                'button',
                { type: 'button', className: 'dsh-memory-button', disabled: loadingMore, onClick: () => void loadMore() },
                loadingMore ? t('Loading…', '加载中…') : t('Load more', '加载更多'),
              ),
            )
          : null,
      ),
    ),
  )
}

    // ----------------------------------------------------------------- settings

    function fieldValue(view, section, key) {
      return view?.[section]?.[key] ?? ''
    }

    function numberOrEmpty(value) {
      return value === undefined || value === null ? '' : String(value)
    }

    function toInteger(value, fallback) {
      const parsed = Number.parseInt(value, 10)
      return Number.isFinite(parsed) ? parsed : fallback
    }

    function toNumber(value, fallback) {
      const parsed = Number.parseFloat(value)
      return Number.isFinite(parsed) ? parsed : fallback
    }

    function acceptanceLabel(stats) {
      const auto = stats?.autoCapture
      if (auto === undefined || auto === null) return ''
      const active = (auto.llm?.active ?? 0) + (auto.rules?.active ?? 0)
      const dismissed = (auto.llm?.dismissed ?? 0) + (auto.rules?.dismissed ?? 0)
      const total = active + dismissed
      return total > 0 ? ` · ${Math.round((active / total) * 100)}% auto-accepted` : ''
    }

    function MemorySettings(props) {
      const client = props.client
      const t = props.t
      const [view, setView] = useState(null)
      const [draft, setDraft] = useState(null)
      const [stats, setStats] = useState(null)
      const [apiKeyDraft, setApiKeyDraft] = useState('')
      const [extractionKeyDraft, setExtractionKeyDraft] = useState('')
      const [loading, setLoading] = useState(true)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState(null)
      const [saved, setSaved] = useState(false)
      const [exportedPath, setExportedPath] = useState(null)
      const [importNotice, setImportNotice] = useState(null)
      const [backups, setBackups] = useState([])
      const [backupNotice, setBackupNotice] = useState(null)
      const [backupBusy, setBackupBusy] = useState(false)

      async function load() {
        setLoading(true)
        setError(null)
        try {
          const [nextView, nextStats, nextBackups] = await Promise.all([
            client.getSettings(),
            client.stats(),
            client.listBackups().catch(() => []),
          ])
          setView(nextView)
          setDraft(nextView)
          setStats(nextStats)
          setBackups(Array.isArray(nextBackups) ? nextBackups : [])
          setApiKeyDraft('')
          setExtractionKeyDraft('')
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setLoading(false)
        }
      }

      useEffect(() => {
        void load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      function edit(section, key, value) {
        setSaved(false)
        setDraft((current) => (current === null ? current : { ...current, [section]: { ...current[section], [key]: value } }))
      }

      function editNested(section, nestedKey, key, value) {
        setSaved(false)
        setDraft((current) =>
          current === null
            ? current
            : {
                ...current,
                [section]: {
                  ...current[section],
                  [nestedKey]: { ...(current[section]?.[nestedKey] ?? {}), [key]: value },
                },
              },
        )
      }

      function buildPatch() {
        const patch = {
          embedding: {
            baseURL: String(draft.embedding.baseURL ?? '').trim(),
            model: String(draft.embedding.model ?? '').trim(),
            dimensions: toInteger(draft.embedding.dimensions, 1024),
            timeoutMs: toInteger(draft.embedding.timeoutMs, 3000),
            queryInstruction: String(draft.embedding.queryInstruction ?? '').trim(),
          },
          capture: {
            defaultScope: draft.capture.defaultScope,
            dedupeThreshold: toNumber(draft.capture.dedupeThreshold, 0.93),
            mode: draft.capture.mode,
            extractEveryTurns: toInteger(draft.capture.extractEveryTurns, 0),
            dailyTokenBudget: toInteger(draft.capture.dailyTokenBudget, 50000),
            candidateTtlDays: toInteger(draft.capture.candidateTtlDays, 30),
            llm: {
              baseURL: String(draft.capture.llm?.baseURL ?? '').trim(),
              model: String(draft.capture.llm?.model ?? '').trim(),
              contextWindow: toInteger(draft.capture.llm?.contextWindow, 32768),
              maxOutputTokens: toInteger(draft.capture.llm?.maxOutputTokens, 1600),
              timeoutMs: toInteger(draft.capture.llm?.timeoutMs, 80000),
            },
            admission: {
              enabled: Boolean(draft.capture.admission?.enabled),
              minConfidence: toNumber(draft.capture.admission?.minConfidence, 0.7),
              maxPerRun: toInteger(draft.capture.admission?.maxPerRun, 8),
              includeRules: Boolean(draft.capture.admission?.includeRules),
            },
            extractDebounceMs: toInteger(draft.capture.extractDebounceMs, 15000),
            conflictDetection: Boolean(draft.capture.conflictDetection),
            conflictSimilarity: toNumber(draft.capture.conflictSimilarity, 0.82),
            conflictJudge: {
              enabled: Boolean(draft.capture.conflictJudge?.enabled),
              minSimilarity: toNumber(draft.capture.conflictJudge?.minSimilarity, 0.6),
              autoApplyConfidence: toNumber(draft.capture.conflictJudge?.autoApplyConfidence, 0.85),
              reviewConfidence: toNumber(draft.capture.conflictJudge?.reviewConfidence, 0.5),
              maxCandidates: toInteger(draft.capture.conflictJudge?.maxCandidates, 5),
              timeoutMs: toInteger(draft.capture.conflictJudge?.timeoutMs, 15000),
              autoContradictNewWins: Boolean(draft.capture.conflictJudge?.autoContradictNewWins),
            },
          },
          recall: {
            failureHints: Boolean(draft.recall.failureHints),
            failureHintMinSimilarity: toNumber(draft.recall.failureHintMinSimilarity, 0.45),
            failureHintMaxPerSession: toInteger(draft.recall.failureHintMaxPerSession, 3),
            ratings: {
              enabled: Boolean(draft.recall.ratings?.enabled),
              defaultRating: draft.recall.ratings?.defaultRating === 'somewhat_relevant' ? 'somewhat_relevant' : 'unknown',
            },
          },
          inject: {
            coreMemories: toInteger(draft.inject.coreMemories, 10),
            coreMinImportance: toInteger(draft.inject.coreMinImportance, 3),
            includeWorkspace: Boolean(draft.inject.includeWorkspace),
            corePitfalls: toInteger(draft.inject.corePitfalls, 3),
            proactiveRecall: {
              enabled: Boolean(draft.inject.proactiveRecall?.enabled),
              maxMemories: toInteger(draft.inject.proactiveRecall?.maxMemories, 5),
              minSimilarity: toNumber(draft.inject.proactiveRecall?.minSimilarity, 0.33),
              maxChars: toInteger(draft.inject.proactiveRecall?.maxChars, 1200),
            },
          },
          retrieval: { defaultLimit: toInteger(draft.retrieval.defaultLimit, 5) },
          periodic: {
            enabled: Boolean(draft.periodic.enabled),
            intervalMinutes: toInteger(draft.periodic.intervalMinutes, 30),
            maxExtractionsPerDay: toInteger(draft.periodic.maxExtractionsPerDay, 12),
            projectDigest: Boolean(draft.periodic.projectDigest),
          },
          graph: { enabled: Boolean(draft.graph.enabled), maxHops: toInteger(draft.graph.maxHops, 2) },
        }
        if (apiKeyDraft.trim() !== '') patch.embedding.apiKey = apiKeyDraft.trim()
        if (extractionKeyDraft.trim() !== '') patch.capture.llm.apiKey = extractionKeyDraft.trim()
        return patch
      }

      async function save() {
        if (draft === null) return
        setSaving(true)
        setError(null)
        setSaved(false)
        try {
          const nextView = await client.setSettings(buildPatch())
          setView(nextView)
          setDraft(nextView)
          setApiKeyDraft('')
          setSaved(true)
          try {
            setStats(await client.stats())
          } catch {
            /* health refresh is best effort */
          }
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setSaving(false)
        }
      }

      async function exportData(format) {
        setError(null)
        setExportedPath(null)
        try {
          const result = await client.exportData({ format, status: 'active' })
          setExportedPath(`${result.count} ${t('memories exported to', '条记忆已导出到')} ${result.path}`)
        } catch (failure) {
          setError(errorText(failure))
        }
      }

      async function createBackup() {
        setBackupBusy(true)
        setError(null)
        setBackupNotice(null)
        try {
          const result = await client.createBackup('manual')
          setBackupNotice(`${t('Backup created', '备份已创建')}: ${result.name} (${Math.round((result.size ?? 0) / 1024)} KB)`)
          setBackups(await client.listBackups())
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBackupBusy(false)
        }
      }

      async function restoreBackup(name) {
        if (typeof confirm === 'function' && !confirm(`${t('Restore records and revisions from', '从备份恢复记忆与修订历史')} ${name}?\n${t('Current data is backed up automatically first; existing rows are merged, not deleted.', '会先自动备份当前库；恢复是合并，不会删除当前已有记忆。')}`)) return
        setBackupBusy(true)
        setError(null)
        setBackupNotice(null)
        try {
          const result = await client.restoreBackup(name)
          setBackupNotice(
            `${t('Restored', '恢复完成')}: +${result.imported ?? 0} ${t('new', '新增')} / ${result.updated ?? 0} ${t('updated', '更新')} / ${result.skipped ?? 0} ${t('skipped', '跳过')} · ${t('safety backup', '安全备份')}: ${result.safetyBackup ?? '-'}`,
          )
          await load()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setBackupBusy(false)
        }
      }

      async function importFile(event) {
        const file = event?.target?.files?.[0]
        if (file === undefined || file === null) return
        setError(null)
        setImportNotice(null)
        try {
          const text = await file.text()
          const bundle = JSON.parse(text)
          const result = await client.importData(bundle, file.name)
          setImportNotice(
            `${t('Imported', '导入完成')}: +${result.imported ?? 0} ${t('new', '新增')} / ${result.updated ?? 0} ${t('updated', '更新')} / ${result.skipped ?? 0} ${t('skipped', '跳过')} / ${result.failed ?? 0} ${t('failed', '失败')}`,
          )
          await load()
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          if (event?.target) event.target.value = ''
        }
      }

      async function clearExtractionKey() {
        setSaving(true)
        setError(null)
        try {
          const nextView = await client.setSettings({ capture: { llm: { apiKey: '' } } })
          setView(nextView)
          setDraft(nextView)
          setSaved(true)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setSaving(false)
        }
      }

      async function clearApiKey() {
        setSaving(true)
        setError(null)
        try {
          const nextView = await client.setSettings({ embedding: { apiKey: '' } })
          setView(nextView)
          setDraft(nextView)
          setSaved(true)
        } catch (failure) {
          setError(errorText(failure))
        } finally {
          setSaving(false)
        }
      }

      if (loading || draft === null) {
        return h(
          'div',
          { className: 'dsh-memory-page' },
          h('style', null, PAGE_CSS),
          h('div', { className: 'dsh-memory-loading' }, t('Loading settings…', '加载设置中…')),
          error !== null ? h('div', { className: 'dsh-memory-banner error' }, error) : null,
        )
      }

      const embedderHealthy = stats !== null && stats.embedder !== undefined && stats.embedder.ok === true

      return h(
        'div',
        { className: 'dsh-memory-page' },
        h('style', null, PAGE_CSS),
        h(
          'div',
          { className: 'dsh-memory-header' },
          h('h2', { className: 'dsh-memory-title' }, t('Memory settings', '记忆设置')),
          h(
            'div',
            { className: 'dsh-memory-subtitle' },
            `${stats?.count ?? 0} ${t('memories', '条记忆')} · ${stats?.pendingEmbeddings ?? 0} ${t('pending embeddings', '条待补向量')} · ${embedderHealthy ? t('embedder healthy', '嵌入服务正常') : t('embedder unavailable', '嵌入服务不可用')} · ${stats?.storage?.backend ?? 'sqlite'}${acceptanceLabel(stats)}`,
          ),
          h(
            'div',
            { className: 'dsh-memory-actions-row' },
            h('button', { type: 'button', className: 'dsh-memory-button', disabled: saving, onClick: () => void load() }, t('Reset', '恢复已保存')),
            h(
              'button',
              { type: 'button', className: 'dsh-memory-button primary', disabled: saving, onClick: () => void save() },
              saving ? t('Saving…', '保存中…') : t('Save', '保存'),
            ),
          ),
        ),
        error !== null ? h('div', { className: 'dsh-memory-banner error' }, error) : null,
        saved ? h('div', { className: 'dsh-memory-banner ok' }, t('Settings saved and applied live.', '设置已保存并即时生效。')) : null,
        exportedPath !== null ? h('div', { className: 'dsh-memory-banner ok' }, exportedPath) : null,
        importNotice !== null ? h('div', { className: 'dsh-memory-banner ok' }, importNotice) : null,
        h(
          'details',
          { className: 'dsh-memory-section', open: true },
          h(
            'summary',
            null,
            h('span', { className: 'dsh-memory-section-title' }, t('Embedding & storage', '嵌入与存储')),
            h('span', { className: 'dsh-memory-section-desc' }, t('Endpoint, model, API key and where memories live.', '服务地址、模型、API Key，以及记忆存储位置。')),
          ),
          h(
            'div',
            { className: 'dsh-memory-grid' },
            h('label', null, 'Base URL'),
            h('input', {
              className: 'dsh-memory-input',
              value: fieldValue(draft, 'embedding', 'baseURL'),
              placeholder: 'https://embedding.example.com/v1',
              onChange: (event) => edit('embedding', 'baseURL', event.target.value),
            }),
            h('label', null, t('Model', '模型')),
            h('input', {
              className: 'dsh-memory-input',
              value: fieldValue(draft, 'embedding', 'model'),
              placeholder: 'your-embedding-model',
              onChange: (event) => edit('embedding', 'model', event.target.value),
            }),
            h('label', null, t('Dimensions', '维度')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1,
              value: numberOrEmpty(fieldValue(draft, 'embedding', 'dimensions')),
              onChange: (event) => edit('embedding', 'dimensions', event.target.value),
            }),
            h('label', null, t('API key', 'API Key')),
            h(
              'div',
              { className: 'dsh-memory-actions-row' },
              h('input', {
                className: 'dsh-memory-input',
                type: 'password',
                value: apiKeyDraft,
                placeholder: draft.embedding.apiKeySet ? t('configured — leave empty to keep', '已配置，留空保持不变') : t('not configured', '未配置'),
                onChange: (event) => {
                  setSaved(false)
                  setApiKeyDraft(event.target.value)
                },
              }),
              draft.embedding.apiKeySet
                ? h('button', { type: 'button', className: 'dsh-memory-button danger', disabled: saving, onClick: () => void clearApiKey() }, t('Clear', '清除'))
                : null,
            ),
            h('label', null, t('Timeout (ms)', '超时（毫秒）')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 250,
              value: numberOrEmpty(fieldValue(draft, 'embedding', 'timeoutMs')),
              onChange: (event) => edit('embedding', 'timeoutMs', event.target.value),
            }),
            h('label', null, t('Query instruction', '查询指令')),
            h('input', {
              className: 'dsh-memory-input',
              value: fieldValue(draft, 'embedding', 'queryInstruction'),
              placeholder: 'Given a user query, retrieve relevant durable personal memories',
              onChange: (event) => edit('embedding', 'queryInstruction', event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'dsh-memory-hint' },
            embedderHealthy
              ? t(`Endpoint reachable — ${stats.embedder.latencyMs}ms round trip.`, `服务可达 — 往返 ${stats.embedder.latencyMs}ms。`)
              : t('Endpoint unreachable; retrieval stays keyword-only until it recovers.', '服务不可达；恢复前检索降级为纯关键词。'),
          ),
          h(
            'div',
            { className: 'dsh-memory-hint' },
            t(
              `API key is kept in a credential record, not in settings. Storage: ${stats?.storage?.backend ?? 'sqlite'}${stats?.storage?.location ? ` — ${stats.storage.location}` : ''}.`,
              `API Key 保存在凭证记录中，不写入设置。存储：${stats?.storage?.backend ?? 'sqlite'}${stats?.storage?.location ? ` — ${stats.storage.location}` : ''}。`,
            ),
          ),
        ),
        h(
          'details',
          { className: 'dsh-memory-section' },
          h(
            'summary',
            null,
            h('span', { className: 'dsh-memory-section-title' }, t('Injection & recall', '注入与召回')),
            h('span', { className: 'dsh-memory-section-desc' }, t('Default scope, session-start core memories and character budgets.', '默认作用域、会话开头注入的核心记忆与字符预算。')),
          ),
          h(
            'div',
            { className: 'dsh-memory-grid' },
            h('label', null, t('Default scope', '默认作用域')),
            h(
              'select',
              {
                className: 'dsh-memory-select',
                value: fieldValue(draft, 'capture', 'defaultScope'),
                onChange: (event) => edit('capture', 'defaultScope', event.target.value),
              },
              ...SCOPES.map((item) => h('option', { key: item, value: item }, labelOf(SCOPE_LABELS, item, t))),
            ),
            h('label', null, t('Dedupe threshold', '去重阈值')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0.5,
              max: 1,
              step: 0.01,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'dedupeThreshold')),
              onChange: (event) => edit('capture', 'dedupeThreshold', event.target.value),
            }),
            h('label', null, t('Detect possible conflicts', '检测潜在冲突')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'capture', 'conflictDetection')),
                onChange: (event) => edit('capture', 'conflictDetection', event.target.checked),
              }),
              h('span', null, t('flag similar but non-duplicate memories for review', '把相似但不重复的记忆标记为待复核')),
            ),
            h('label', null, t('Conflict similarity', '冲突相似度阈值（启发式兜底）')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0.5,
              max: 1,
              step: 0.01,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'conflictSimilarity')),
              onChange: (event) => edit('capture', 'conflictSimilarity', event.target.value),
            }),
            h('label', null, t('LLM conflict judge', 'LLM 冲突判定')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'capture', 'conflictJudge')?.enabled),
                onChange: (event) => editNested('capture', 'conflictJudge', 'enabled', event.target.checked),
              }),
              h('span', null, t('use the configured model to decide update/contradict/compatible', '用模型判断更新/矛盾/可共存')),
            ),
            h('label', null, t('LLM shortlist similarity', 'LLM 候选相似度')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0.3,
              max: 1,
              step: 0.01,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'conflictJudge')?.minSimilarity),
              onChange: (event) => editNested('capture', 'conflictJudge', 'minSimilarity', event.target.value),
            }),
            h('label', null, t('Auto-apply confidence', '自动处理置信度')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0.5,
              max: 1,
              step: 0.01,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'conflictJudge')?.autoApplyConfidence),
              onChange: (event) => editNested('capture', 'conflictJudge', 'autoApplyConfidence', event.target.value),
            }),
            h(
              'details',
              { className: 'dsh-memory-advanced' },
              h('summary', null, t('Advanced / conflict judge', '高级 / 冲突判定')),
              h('label', null, t('Review confidence', '进入人工复核的置信度')),
              h('input', {
                className: 'dsh-memory-input',
                type: 'number',
                min: 0,
                max: 1,
                step: 0.01,
                value: numberOrEmpty(fieldValue(draft, 'capture', 'conflictJudge')?.reviewConfidence),
                onChange: (event) => editNested('capture', 'conflictJudge', 'reviewConfidence', event.target.value),
              }),
              h('label', null, t('Max candidates per judge call', '单次判定最多候选数')),
              h('input', {
                className: 'dsh-memory-input',
                type: 'number',
                min: 1,
                max: 20,
                value: numberOrEmpty(fieldValue(draft, 'capture', 'conflictJudge')?.maxCandidates),
                onChange: (event) => editNested('capture', 'conflictJudge', 'maxCandidates', event.target.value),
              }),
              h('label', null, t('LLM timeout (ms)', 'LLM 超时（毫秒）')),
              h('input', {
                className: 'dsh-memory-input',
                type: 'number',
                min: 1000,
                max: 120000,
                step: 1000,
                value: numberOrEmpty(fieldValue(draft, 'capture', 'conflictJudge')?.timeoutMs),
                onChange: (event) => editNested('capture', 'conflictJudge', 'timeoutMs', event.target.value),
              }),
              h(
                'label',
                { className: 'dsh-memory-check' },
                h('input', {
                  type: 'checkbox',
                  checked: Boolean(fieldValue(draft, 'capture', 'conflictJudge')?.autoContradictNewWins),
                  onChange: (event) => editNested('capture', 'conflictJudge', 'autoContradictNewWins', event.target.checked),
                }),
                h('span', null, t('on contradiction, automatically prefer the newer memory', '矛盾时自动采用较新的记忆')),
              ),
            ),
            h('label', null, t('Default results', '默认返回条数')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1,
              max: 20,
              value: numberOrEmpty(fieldValue(draft, 'retrieval', 'defaultLimit')),
              onChange: (event) => edit('retrieval', 'defaultLimit', event.target.value),
            }),
            h('label', null, t('Core memories', '核心记忆条数')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              max: 100,
              value: numberOrEmpty(fieldValue(draft, 'inject', 'coreMemories')),
              onChange: (event) => edit('inject', 'coreMemories', event.target.value),
            }),
            h('label', null, t('Core minimum importance', '核心记忆最低重要度')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1,
              max: 5,
              value: numberOrEmpty(fieldValue(draft, 'inject', 'coreMinImportance')),
              onChange: (event) => edit('inject', 'coreMinImportance', event.target.value),
            }),
            h('label', null, t('Include workspace memories', '注入包含工作区记忆')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'inject', 'includeWorkspace')),
                onChange: (event) => edit('inject', 'includeWorkspace', event.target.checked),
              }),
              h('span', null, t('inject memories scoped to the current working directory', '注入当前工作目录作用域的记忆')),
            ),
            h('label', null, t('Core pitfalls at session start', '会话开头注入的坑数')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              max: 20,
              value: numberOrEmpty(fieldValue(draft, 'inject', 'corePitfalls')),
              onChange: (event) => edit('inject', 'corePitfalls', event.target.value),
            }),
            h('label', null, t('First-turn proactive recall', '首轮主动召回')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'inject', 'proactiveRecall')?.enabled),
                onChange: (event) => editNested('inject', 'proactiveRecall', 'enabled', event.target.checked),
              }),
              h('span', null, t('inject memories matching the first user message', '按第一条用户消息注入相关记忆')),
            ),
            h('label', null, t('Proactive recall count', '主动召回条数')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              max: 20,
              value: numberOrEmpty(fieldValue(draft, 'inject', 'proactiveRecall')?.maxMemories),
              onChange: (event) => editNested('inject', 'proactiveRecall', 'maxMemories', event.target.value),
            }),
            h('label', null, t('Proactive minimum similarity', '主动召回最低相似度')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              max: 1,
              step: 0.01,
              value: numberOrEmpty(fieldValue(draft, 'inject', 'proactiveRecall')?.minSimilarity),
              onChange: (event) => editNested('inject', 'proactiveRecall', 'minSimilarity', event.target.value),
            }),
            h('label', null, t('In-conversation recall ratings', '对话内召回评分')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'recall', 'ratings')?.enabled),
                onChange: (event) => editNested('recall', 'ratings', 'enabled', event.target.checked),
              }),
              h('span', null, t('show the recall tray above the composer', '在输入框上方显示召回托盘')),
            ),
            h('label', null, t('Unrated default', '未评价默认值')),
            h(
              'select',
              {
                className: 'dsh-memory-select',
                value: fieldValue(draft, 'recall', 'ratings')?.defaultRating ?? 'unknown',
                onChange: (event) => editNested('recall', 'ratings', 'defaultRating', event.target.value),
              },
              h('option', { value: 'unknown' }, t('Unknown — excluded from accuracy', '未评价 — 不计入准确率')),
              h('option', { value: 'somewhat_relevant' }, t('Somewhat relevant — 0.25 weight', '一般相关 — 0.25 权重')),
            ),
          ),
          h(
            'div',
            { className: 'dsh-memory-hint' },
            t(
              'Memory content and per-entry controls live in the sidebar Memory panel.',
              '记忆内容和逐条管理在左侧栏的「记忆」面板中。',
            ),
          ),
        ),
        h(
          'details',
          { className: 'dsh-memory-section' },
          h(
            'summary',
            null,
            h('span', { className: 'dsh-memory-section-title' }, t('Automatic capture & LLM admission', '自动捕获与 LLM 准入')),
            h('span', { className: 'dsh-memory-section-desc' }, t('Candidate extraction, the admission judge, budgets and periodic scan.', '候选抽取、自动准入判定、预算与周期扫描。')),
          ),
          h(
            'div',
            { className: 'dsh-memory-grid' },
            h('label', null, t('Auto capture', '自动捕获')),
            h(
              'select',
              {
                className: 'dsh-memory-select',
                value: fieldValue(draft, 'capture', 'mode'),
                onChange: (event) => edit('capture', 'mode', event.target.value),
              },
              ...[
                ['off', t('Off', '关闭')],
                ['rules', t('Rules only', '仅规则')],
                ['rules+llm', t('Rules + LLM', '规则 + LLM')],
              ].map(([value, label]) => h('option', { key: value, value }, label)),
            ),
            h('label', null, t('LLM admission judge', 'LLM 自动准入')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'capture', 'admission')?.enabled),
                onChange: (event) => editNested('capture', 'admission', 'enabled', event.target.checked),
              }),
              h('span', null, t('auto-admit candidates with the extraction model', '用抽取模型自动判断候选是否进入记忆')),
            ),
            h('label', null, t('Admission confidence floor', '准入置信度下限')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              max: 1,
              step: '0.05',
              value: numberOrEmpty(fieldValue(draft, 'capture', 'admission')?.minConfidence),
              onChange: (event) => editNested('capture', 'admission', 'minConfidence', event.target.value),
            }),
            h('label', null, t('Admissions per run', '每轮最多准入')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              max: 50,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'admission')?.maxPerRun),
              onChange: (event) => editNested('capture', 'admission', 'maxPerRun', event.target.value),
            }),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'capture', 'admission')?.includeRules),
                onChange: (event) => editNested('capture', 'admission', 'includeRules', event.target.checked),
              }),
              h('span', null, t('also admit rule-layer candidates', '规则层候选也走自动准入')),
            ),
            h('label', null, t('Extraction API URL', '抽取模型 API URL')),
            h('input', {
              className: 'dsh-memory-input',
              value: draft.capture.llm?.baseURL ?? '',
              placeholder: 'https://embedding.example.com/v1',
              onChange: (event) => editNested('capture', 'llm', 'baseURL', event.target.value),
            }),
            h('label', null, t('Extraction model', '抽取模型名')),
            h('input', {
              className: 'dsh-memory-input',
              value: draft.capture.llm?.model ?? '',
              placeholder: 'your-chat-model',
              onChange: (event) => editNested('capture', 'llm', 'model', event.target.value),
            }),
            h('label', null, t('Extraction API key', '抽取模型 API Key')),
            h(
              'div',
              { className: 'dsh-memory-actions-row' },
              h('input', {
                className: 'dsh-memory-input',
                type: 'password',
                value: extractionKeyDraft,
                placeholder: draft.capture.llm?.apiKeySet ? t('configured — leave empty to keep', '已配置，留空保持不变') : t('not configured', '未配置'),
                onChange: (event) => {
                  setSaved(false)
                  setExtractionKeyDraft(event.target.value)
                },
              }),
              draft.capture.llm?.apiKeySet
                ? h('button', { type: 'button', className: 'dsh-memory-button danger', disabled: saving, onClick: () => void clearExtractionKey() }, t('Clear', '清除'))
                : null,
            ),
            h('label', null, t('Context window (tokens)', '模型上下文（tokens）')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1024,
              value: numberOrEmpty(draft.capture.llm?.contextWindow),
              onChange: (event) => editNested('capture', 'llm', 'contextWindow', event.target.value),
            }),
            h('label', null, t('Max output tokens', '最大输出 tokens')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 64,
              value: numberOrEmpty(draft.capture.llm?.maxOutputTokens),
              onChange: (event) => editNested('capture', 'llm', 'maxOutputTokens', event.target.value),
            }),
            h('label', null, t('Request timeout (ms)', '请求超时（毫秒）')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1000,
              value: numberOrEmpty(draft.capture.llm?.timeoutMs),
              onChange: (event) => editNested('capture', 'llm', 'timeoutMs', event.target.value),
            }),
            h('label', null, t('Extraction debounce (ms)', '抽取防抖（毫秒）')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1000,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'extractDebounceMs')),
              onChange: (event) => edit('capture', 'extractDebounceMs', event.target.value),
            }),
            h('label', null, t('Extract every N turns', '每 N 回合抽取（0 = 仅事件触发）')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'extractEveryTurns')),
              onChange: (event) => edit('capture', 'extractEveryTurns', event.target.value),
            }),
            h('label', null, t('Daily token budget', '每日 token 预算')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'dailyTokenBudget')),
              onChange: (event) => edit('capture', 'dailyTokenBudget', event.target.value),
            }),
            h('label', null, t('Candidate TTL (days)', '候选保留天数')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1,
              value: numberOrEmpty(fieldValue(draft, 'capture', 'candidateTtlDays')),
              onChange: (event) => edit('capture', 'candidateTtlDays', event.target.value),
            }),
            h('label', null, t('Failure hints', '失败时提示已知坑')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'recall', 'failureHints')),
                onChange: (event) => edit('recall', 'failureHints', event.target.checked),
              }),
              h('span', null, t('attach known pitfalls to failed tool results', '工具失败时附带已知坑')),
            ),
            h('label', null, t('Periodic extraction', '周期抽取')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'periodic', 'enabled')),
                onChange: (event) => edit('periodic', 'enabled', event.target.checked),
              }),
              h('span', null, t('scan recent project sessions', '扫描最近的项目会话')),
            ),
            h('label', null, t('Interval (minutes)', '抽取间隔（分钟）')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1,
              value: numberOrEmpty(fieldValue(draft, 'periodic', 'intervalMinutes')),
              onChange: (event) => edit('periodic', 'intervalMinutes', event.target.value),
            }),
            h('label', null, t('Max extractions per day', '每日抽取次数上限')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 0,
              value: numberOrEmpty(fieldValue(draft, 'periodic', 'maxExtractionsPerDay')),
              onChange: (event) => edit('periodic', 'maxExtractionsPerDay', event.target.value),
            }),
            h('label', null, t('SQLite graph retrieval', 'SQLite 图检索')),
            h(
              'label',
              { className: 'dsh-memory-check' },
              h('input', {
                type: 'checkbox',
                checked: Boolean(fieldValue(draft, 'graph', 'enabled')),
                onChange: (event) => edit('graph', 'enabled', event.target.checked),
              }),
              h('span', null, t('expand results through shared project/signature/tag nodes', '通过项目/错误签名/标签节点扩展结果')),
            ),
            h('label', null, t('Graph expansion hops', '图扩展跳数')),
            h('input', {
              className: 'dsh-memory-input',
              type: 'number',
              min: 1,
              max: 3,
              value: numberOrEmpty(fieldValue(draft, 'graph', 'maxHops')),
              onChange: (event) => edit('graph', 'maxHops', event.target.value),
            }),
          ),
        ),
        h(
          'details',
          { className: 'dsh-memory-section' },
          h(
            'summary',
            null,
            h('span', { className: 'dsh-memory-section-title' }, t('Data & backups', '数据与备份')),
            h('span', { className: 'dsh-memory-section-desc' }, t('Export/import JSON (with revisions), database backups and one-click restore.', '导出/导入 JSON（含修订历史）、数据库备份与一键恢复。')),
          ),
          h(
            'div',
            { className: 'dsh-memory-grid' },
            h('label', null, t('Export', '导出')),
            h(
              'div',
              { className: 'dsh-memory-actions-row' },
              h('button', { type: 'button', className: 'dsh-memory-button', onClick: () => void exportData('json') }, t('Export JSON', '导出 JSON')),
              h('button', { type: 'button', className: 'dsh-memory-button', onClick: () => void exportData('markdown') }, t('Export Markdown', '导出 Markdown')),
            ),
            h('label', null, t('Import / restore JSON', '导入 / 恢复 JSON')),
            h('input', { className: 'dsh-memory-input', type: 'file', accept: '.json,application/json', onChange: (event) => void importFile(event) }),
            h('label', null, t('Database backups', '数据库备份')),
            h(
              'div',
              { className: 'dsh-memory-actions-row' },
              h(
                'button',
                { type: 'button', className: 'dsh-memory-button', disabled: backupBusy, onClick: () => void createBackup() },
                backupBusy ? t('Working…', '处理中…') : t('Back up now', '立即备份'),
              ),
            ),
            backupNotice !== null ? h('div', { className: 'dsh-memory-banner ok' }, backupNotice) : null,
            ...backups.slice(0, 10).map((backup) =>
              h(
                'div',
                { key: backup.name, className: 'dsh-memory-meta' },
                h('span', null, backup.name),
                h('span', null, `${Math.round(backup.size / 1024)} KB`),
                h('span', null, new Date(backup.createdAt).toLocaleString()),
                h(
                  'button',
                  { type: 'button', className: 'dsh-memory-button', disabled: backupBusy, onClick: () => void restoreBackup(backup.name) },
                  t('Restore', '恢复'),
                ),
              ),
            ),
                      ),
        ),
        h(
          'div',
          { className: 'dsh-memory-savebar' },
          h('button', { type: 'button', className: 'dsh-memory-button primary', disabled: saving, onClick: () => void save() }, saving ? t('Saving…', '保存中…') : t('Save', '保存')),
          h('button', { type: 'button', className: 'dsh-memory-button', disabled: saving, onClick: () => void load() }, t('Reset', '恢复已保存')),
        ),
      )
    }

    // -------------------------------------------------------------------- entry

    const inject = ['slots', 'locale', 'connection']

    function apply(ctx) {
      const locale = ctx.get('locale')
      const connection = ctx.get('connection')
      const t = (en, zh) => {
        try {
          if (locale !== undefined && typeof locale.resolveText === 'function') return locale.resolveText({ en, zh })
        } catch {
          // fall through to English
        }
        return en
      }
      const client = new MemoryClient(connection === undefined ? undefined : connection.rpc)

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          {
            name: 'settings.section',
            id: 'memory',
            order: 25,
            label: () => t('Memory', '记忆'),
          },
          (props) => h(MemorySettings, { ...props, client, t }),
        ),
      )

      ctx.slots.inject('settings.section.icon', () =>
        ctx.slots.register({ name: 'settings.section.icon', id: 'memory', order: 25 }, MemoryIcon),
      )

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: 'memory' }, (props) => h(MemoryBrowser, { ...props, client, t })),
      )

      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register(
          { name: 'conversation.input.dock', id: 'memory-recall', order: 30 },
          (props) => h(MemoryRecallDock, { ...props, client, t }),
        ),
      )

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          { name: 'sidebar.panellist', id: 'memory', order: 20, label: () => t('Memory', '记忆') },
          MemoryIcon,
        ),
      )
    }

    return { inject, apply }
  },
})

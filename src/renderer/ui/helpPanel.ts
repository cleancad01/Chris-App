import type { HelpMeResult } from '../../shared/types';
import { $, h } from './dom';
import { segmentEl } from './transcriptView';

export class HelpPanel {
  private panel = $('help');
  private btn = $<HTMLButtonElement>('helpBtn');
  private busy = false;
  private enabled = false;
  private last?: HelpMeResult;

  constructor(private ask: () => Promise<HelpMeResult>) {
    this.btn.addEventListener('click', () => void this.run());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F9' || (e.ctrlKey && e.key === 'Enter')) { e.preventDefault(); void this.run(); }
    });
  }

  setEnabled(v: boolean): void { this.enabled = v; this.sync(); }

  private sync(): void {
    this.btn.disabled = !this.enabled || this.busy;
    this.btn.replaceChildren();
    if (this.busy) this.btn.append(h('span', 'spin'), document.createTextNode('Thinking...'));
    else { this.btn.append(document.createTextNode('Help me ')); this.btn.append(h('small', undefined, '(F9)')); }
    this.panel.classList.toggle('loading', this.busy);
  }

  async run(): Promise<void> {
    if (this.busy || !this.enabled) return;
    this.busy = true; this.sync();
    try { this.last = await this.ask(); }
    catch (e) { this.last = { ok: false, error: e instanceof Error ? e.message : String(e), fallbackTranscript: [] }; }
    this.busy = false; this.sync(); this.render();
  }

  private render(): void {
    const r = this.last;
    if (!r) return;
    const p = this.panel;
    p.replaceChildren();
    if (r.ok) {
      const x = r.response;
      p.append(h('h4', undefined, 'Answer'), h('p', 'answer', x.answer || '(no answer)'), h('div', 'conf', x.confidence));
      if (x.overview) p.append(h('h4', undefined, 'Overview'), h('div', undefined, x.overview));
      if (x.connections.length) {
        p.append(h('h4', undefined, 'Connections'));
        for (const c of x.connections) {
          const d = h('div', 'conn');
          d.append(h('b', undefined, c.concept), document.createTextNode(' - ' + c.relation), h('span', `badge ${c.source}`, c.source));
          p.append(d);
        }
      }
    } else {
      p.append(h('p', 'error', r.error));
      const retry = h('button', undefined, 'Retry');
      retry.addEventListener('click', () => void this.run());
      p.append(retry);
      if (r.fallbackTranscript.length) {
        p.append(h('h4', undefined, 'Recent transcript'));
        for (const s of r.fallbackTranscript) p.append(segmentEl(s));
      }
    }
    p.scrollTop = 0;
  }

  reset(): void { this.last = undefined; this.panel.replaceChildren(); }
}

/**
 * Accessibility unit tests — static HTML axe-core scans.
 * Tests representative HTML patterns from Habitat's components.
 * Fails only on critical violations (impact === 'critical').
 * These tests run in happy-dom via Vitest.
 */

import axe from 'axe-core'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  document.body.removeChild(container)
})

async function runAxe(html: string): Promise<axe.Result[]> {
  container.innerHTML = html
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
    resultTypes: ['violations'],
  })
  return results.violations.filter((v) => v.impact === 'critical')
}

// ── Navigation ────────────────────────────────────────────────────────────────

describe('Navigation', () => {
  it('bottom nav has no critical violations', async () => {
    const violations = await runAxe(`
      <nav aria-label="Main navigation">
        <a href="/" aria-label="Today" aria-current="page">
          <svg aria-hidden="true" focusable="false"><use href="#icon-home"/></svg>
          <span>Today</span>
        </a>
        <a href="/habits" aria-label="Habits">
          <svg aria-hidden="true" focusable="false"><use href="#icon-list"/></svg>
          <span>Habits</span>
        </a>
        <a href="/todos" aria-label="TODOs">
          <svg aria-hidden="true" focusable="false"><use href="#icon-check"/></svg>
          <span>TODOs</span>
        </a>
        <a href="/settings" aria-label="Settings">
          <svg aria-hidden="true" focusable="false"><use href="#icon-cog"/></svg>
          <span>Settings</span>
        </a>
      </nav>
    `)
    if (violations.length > 0) {
      console.error('Navigation a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })

  it('header with logo and controls has no critical violations', async () => {
    const violations = await runAxe(`
      <header>
        <div>
          <svg role="img" aria-label="Habitat" width="24" height="27" viewBox="0 0 40 44" fill="none">
            <line x1="20" y1="40" x2="20" y2="24" stroke="currentColor" stroke-width="2.5"/>
            <path d="M 20,24 C 11,23 4,29 8,34" stroke="currentColor" stroke-width="2.5" fill="none"/>
          </svg>
          <span>Habitat</span>
        </div>
        <nav>
          <button aria-label="Switch to light mode">
            <svg aria-hidden="true" focusable="false"><use href="#icon-sun"/></svg>
          </button>
          <button aria-label="Change theme" aria-expanded="false" aria-haspopup="true">
            <svg aria-hidden="true" focusable="false"><use href="#icon-swatch"/></svg>
          </button>
          <a href="/settings" aria-label="Settings">
            <svg aria-hidden="true" focusable="false"><use href="#icon-cog"/></svg>
          </a>
        </nav>
      </header>
    `)
    if (violations.length > 0) {
      console.error('Header a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })
})

// ── Forms ─────────────────────────────────────────────────────────────────────

describe('Forms', () => {
  it('todo add form has no critical violations', async () => {
    const violations = await runAxe(`
      <form aria-label="Add TODO">
        <div>
          <label for="todo-title">Title <span aria-hidden="true">*</span></label>
          <input id="todo-title" type="text" placeholder="What needs doing?" required aria-required="true" />
        </div>
        <div>
          <label for="todo-desc">Description</label>
          <textarea id="todo-desc" placeholder="Optional details"></textarea>
        </div>
        <div>
          <label for="todo-due">Due date</label>
          <input id="todo-due" type="date" />
        </div>
        <fieldset>
          <legend>Priority</legend>
          <label><input type="radio" name="priority" value="high" /> High</label>
          <label><input type="radio" name="priority" value="medium" checked /> Medium</label>
          <label><input type="radio" name="priority" value="low" /> Low</label>
        </fieldset>
        <div>
          <label for="todo-mins">Estimated minutes</label>
          <input id="todo-mins" type="number" min="1" placeholder="e.g. 30" />
        </div>
        <div>
          <label for="todo-tags">Tags (comma-separated)</label>
          <input id="todo-tags" type="text" placeholder="tag1, tag2" />
        </div>
        <div>
          <button type="button">Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    `)
    if (violations.length > 0) {
      console.error('Todo form a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })

  it('habit log numeric input has no critical violations', async () => {
    const violations = await runAxe(`
      <form aria-label="Log habit value">
        <label for="habit-val">Steps — target 10000</label>
        <input
          id="habit-val"
          type="number"
          min="0"
          step="any"
          aria-describedby="habit-hint"
        />
        <p id="habit-hint">Enter today's total steps</p>
        <button type="submit" aria-label="Save habit log">Save</button>
      </form>
    `)
    if (violations.length > 0) {
      console.error('Habit log form a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })
})

// ── Modals / Overlays ─────────────────────────────────────────────────────────

describe('Modals', () => {
  it('add todo modal has no critical violations', async () => {
    const violations = await runAxe(`
      <div role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title">New TODO</h2>
        <form>
          <label for="modal-title-input">Title <span aria-hidden="true">*</span></label>
          <input id="modal-title-input" type="text" required aria-required="true" />
          <div>
            <button type="button" aria-label="Cancel">Cancel</button>
            <button type="submit">Save</button>
          </div>
        </form>
      </div>
    `)
    if (violations.length > 0) {
      console.error('Modal a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })

  it('theme picker dropdown has no critical violations', async () => {
    const violations = await runAxe(`
      <div role="dialog" aria-label="Select theme">
        <button
          aria-label="Habitat theme"
          aria-pressed="true"
          style="width:28px;height:28px;border-radius:50%;background:#22d3ee"
        ></button>
        <button
          aria-label="Forest theme"
          aria-pressed="false"
          style="width:28px;height:28px;border-radius:50%;background:#10b981"
        ></button>
        <button
          aria-label="Ocean theme"
          aria-pressed="false"
          style="width:28px;height:28px;border-radius:50%;background:#6366f1"
        ></button>
      </div>
    `)
    if (violations.length > 0) {
      console.error('Theme picker a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })
})

// ── Content patterns ──────────────────────────────────────────────────────────

describe('Content patterns', () => {
  it('settings page heading structure has no critical violations', async () => {
    const violations = await runAxe(`
      <main>
        <header>
          <p>Preferences</p>
          <h1>Settings</h1>
        </header>
        <section aria-labelledby="display-heading">
          <h2 id="display-heading">Display</h2>
          <div>
            <label>
              24-hour time
              <input type="checkbox" role="switch" aria-checked="false" />
            </label>
          </div>
        </section>
      </main>
    `)
    if (violations.length > 0) {
      console.error('Settings heading a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })

  it('todo list items have no critical violations', async () => {
    const violations = await runAxe(`
      <ul aria-label="TODOs">
        <li>
          <button aria-label="Mark as done: Buy groceries" aria-pressed="false">
            <svg aria-hidden="true" focusable="false"></svg>
          </button>
          <div>
            <p>Buy groceries</p>
            <time datetime="2026-03-05">Mar 5</time>
          </div>
          <button aria-label="Edit Buy groceries">Edit</button>
        </li>
        <li>
          <button aria-label="Mark as undone: Exercise" aria-pressed="true">
            <svg aria-hidden="true" focusable="false"></svg>
          </button>
          <div>
            <p><s>Exercise</s></p>
          </div>
          <button aria-label="Edit Exercise">Edit</button>
        </li>
      </ul>
    `)
    if (violations.length > 0) {
      console.error('Todo list a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })

  it('habit grid row has no critical violations', async () => {
    const violations = await runAxe(`
      <table aria-label="Habit completion grid">
        <thead>
          <tr>
            <th scope="col">Habit</th>
            <th scope="col" aria-label="Monday March 2">Mon 2</th>
            <th scope="col" aria-label="Tuesday March 3">Tue 3</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Running</th>
            <td>
              <button aria-label="Mark Running as done for Monday March 2" aria-pressed="true">✓</button>
            </td>
            <td>
              <button aria-label="Mark Running as done for Tuesday March 3" aria-pressed="false"></button>
            </td>
          </tr>
        </tbody>
      </table>
    `)
    if (violations.length > 0) {
      console.error('Habit grid a11y violations:', JSON.stringify(violations, null, 2))
    }
    expect(violations).toHaveLength(0)
  })
})

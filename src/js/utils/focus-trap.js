/**
 * FocusTrap Utility for Modal Accessibility (WCAG 2.1 AA)
 * - Traps Tab and Shift+Tab navigation within container
 * - Automatically focuses first focusable element (or container) on activate
 * - Captures Escape key to trigger close callback
 * - Restores focus back to the exact trigger element on deactivate
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'button:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export class FocusTrap {
  /**
   * @param {HTMLElement} element - The modal or container element to trap focus inside
   * @param {Object} [options]
   * @param {Function} [options.onClose] - Callback when Escape is pressed
   * @param {HTMLElement} [options.initialFocus] - Explicit element to focus initially
   * @param {HTMLElement} [options.triggerElement] - Element that triggered the modal
   */
  constructor(element, options = {}) {
    this.element = element;
    this.options = options;
    this.active = false;
    this.previousFocusedElement = options.triggerElement || document.activeElement;
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  getFocusableElements() {
    if (!this.element) return [];
    const elements = Array.from(this.element.querySelectorAll(FOCUSABLE_SELECTOR));
    return elements.filter(el => {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    });
  }

  activate(triggerElement = null) {
    if (this.active) return;
    this.active = true;
    if (triggerElement) {
      this.previousFocusedElement = triggerElement;
    } else if (document.activeElement && document.activeElement !== document.body) {
      this.previousFocusedElement = document.activeElement;
    }

    document.addEventListener('keydown', this.handleKeyDown, true);

    // Focus initial element
    requestAnimationFrame(() => {
      const focusable = this.getFocusableElements();
      const target = this.options.initialFocus || focusable[0] || this.element;
      if (target && typeof target.focus === 'function') {
        if (!target.hasAttribute('tabindex') && target === this.element) {
          target.setAttribute('tabindex', '-1');
        }
        target.focus();
      }
    });
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    document.removeEventListener('keydown', this.handleKeyDown, true);

    // Restore focus back to the trigger element
    if (this.previousFocusedElement && typeof this.previousFocusedElement.focus === 'function') {
      try {
        this.previousFocusedElement.focus();
      } catch (e) {
        // Ignored if element was detached
      }
    }
  }

  handleKeyDown(e) {
    if (!this.active || !this.element) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (typeof this.options.onClose === 'function') {
        this.options.onClose();
      } else {
        this.deactivate();
      }
      return;
    }

    if (e.key === 'Tab') {
      const focusable = this.getFocusableElements();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first || !this.element.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last || !this.element.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }
}

/**
 * Convenient helper to create and activate a trap
 */
export function trapFocus(element, options = {}) {
  const trap = new FocusTrap(element, options);
  trap.activate(options.triggerElement);
  return trap;
}

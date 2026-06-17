// quick-add: route variant 'Choose' to PDP (modal disabled) v4 (deploy 2026-06-17)
import { morph } from '@theme/morph';
import { Component } from '@theme/component';
import { CartUpdateEvent, ThemeEvents, VariantSelectedEvent } from '@theme/events';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { mediaQueryLarge, isMobileBreakpoint, getIOSVersion } from '@theme/utilities';
import VariantPicker from '@theme/variant-picker';

export class QuickAddComponent extends Component {
  /** @type {AbortController | null} */
  #abortController = null;
  /** @type {Map<string, Element>} */
  #cachedContent = new Map();
  /** @type {AbortController} */
  #cartUpdateAbortController = new AbortController();

  get productPageUrl() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    const hotspotProduct = /** @type {import('./product-hotspot').ProductHotspotComponent | null} */ (
      this.closest('product-hotspot-component')
    );
    const productLink = productCard?.getProductCardLink() || hotspotProduct?.getHotspotProductLink();

    if (!productLink?.href) return '';

    const url = new URL(productLink.href);

    if (url.searchParams.has('variant')) {
      return url.toString();
    }

    const selectedVariantId = this.#getSelectedVariantId();
    if (selectedVariantId) {
      url.searchParams.set('variant', selectedVariantId);
    }

    return url.toString();
  }

  /**
   * Gets the currently selected variant ID from the product card
   * @returns {string | null} The variant ID or null
   */
  #getSelectedVariantId() {
    const productCard = /** @type {import('./product-card').ProductCard | null} */ (this.closest('product-card'));
    return productCard?.getSelectedVariantId() || null;
  }

  connectedCallback() {
    super.connectedCallback();

    mediaQueryLarge.addEventListener('change', this.#closeQuickAddModal);
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate, {
      signal: this.#cartUpdateAbortController.signal,
    });
    document.addEventListener(ThemeEvents.variantSelected, this.#updateQuickAddButtonState.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    mediaQueryLarge.removeEventListener('change', this.#closeQuickAddModal);
    this.#abortController?.abort();
    this.#cartUpdateAbortController.abort();
    document.removeEventListener(ThemeEvents.variantSelected, this.#updateQuickAddButtonState.bind(this));
  }

  /**
   * Clears the cached content when cart is updated
   */
  #handleCartUpdate = () => {
    this.#cachedContent.clear();
  };

  /**
   * Re-renders the variant picker in the quick-add modal.
   * @param {Element} newHtml - The element to re-render.
   */
  #updateVariantPicker(newHtml) {
    const modalContent = document.getElementById('quick-add-modal-content');
    if (!modalContent) return;
    const variantPicker = /** @type {VariantPicker | null} */ (modalContent.querySelector('variant-picker'));
    if (!variantPicker) return;
    variantPicker.updateVariantPicker(newHtml);
  }

  /**
   * Handles quick add button click
   * @param {Event} event - The click event
   */
  handleClick = async (event) => {
    event.preventDefault();

    // MAREN: the theme's quick-add modal is unreliable on this store. The dialog-open
    // step intermittently fails to open (and force-opening it freezes the renderer),
    // so the "Choose" popup appeared blank for variant products. Until that theme bug is
    // fixed, route shoppers to the product page, where the variant picker and add-to-cart
    // work correctly. The single-variant "Add" button is unaffected (it submits via
    // product-form-component, not this handler).
    const url = this.productPageUrl;
    if (url) {
      window.location.assign(url);
    }
  };

  #resetScroll() {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    const productDetails = dialogComponent.querySelector('.product-details');
    const productMedia = dialogComponent.querySelector('.product-information__media');
    productDetails?.scrollTo({ top: 0, behavior: 'instant' });
    productMedia?.scrollTo({ top: 0, behavior: 'instant' });
  }

  /** @param {QuickAddDialog} dialogComponent */
  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), {
      once: true,
    });
  }

  #openQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    this.#stayVisibleUntilDialogCloses(dialogComponent);

    dialogComponent.showDialog();

    // MAREN fix: showDialog() opens the native <dialog> inside a requestAnimationFrame,
    // which is nondeterministic after the modal content was just morphed (the dialog ref
    // can be stale/detached), leaving the quick-add popup blank or never opening for
    // variant products. Force-open the live <dialog> as a reliable fallback over a couple
    // of frames.
    const forceOpen = () => {
      const liveDialog = dialogComponent.refs?.dialog || dialogComponent.querySelector('dialog');
      if (liveDialog && !liveDialog.open) {
        try {
          liveDialog.showModal();
        } catch (e) {}
      }
    };
    requestAnimationFrame(() => {
      forceOpen();
      requestAnimationFrame(forceOpen);
    });

    // is nondeterministic when the open attribute is set on the dialog element after .showDialog() is called.
    // Waiting until the open animation starts seemed to be the most reliable metric here.
    const dialog = dialogComponent.refs?.dialog || dialogComponent.querySelector('dialog');
    if (!dialog) return;
    dialog.addEventListener('animationstart', this.#resetScroll.bind(this), { once: true });
  };

  #closeQuickAddModal = () => {
    const dialogComponent = document.getElementById('quick-add-dialog');
    if (!(dialogComponent instanceof QuickAddDialog)) return;

    dialogComponent.closeDialog();
  };

  /**
   * Fetches the product page content
   * @param {string} productPageUrl - The URL of the product page to fetch
   * @returns {Promise<Document | null>}
   */
  async fetchProductPage(productPageUrl) {
    if (!productPageUrl) return null;

    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    try {
      const response = await fetch(productPageUrl, {
        signal: this.#abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch product page: HTTP error ${response.status}`);
      }

      const responseText = await response.text();
      const html = new DOMParser().parseFromString(responseText, 'text/html');

      return html;
    } catch (error) {
      if (error.name === 'AbortError') {
        return null;
      } else {
        throw error;
      }
    } finally {
      this.#abortController = null;
    }
  }

  /**
   * Re-renders the variant picker.
   * @param {Element} productGrid - The product grid element
   */
  async updateQuickAddModal(productGrid) {
    const modalContent = document.getElementById('quick-add-modal-content');

    if (!productGrid || !modalContent) return;

    // MAREN fix: the quick-add modal originally cloned the entire product page grid
    // ([data-product-grid-content]) on desktop. On this store that grid is a full PDP
    // (media gallery + every custom content module: reviews, A+, FAQ, product groups,
    // plus their own dialogs). Morphing all of it into the modal froze the renderer, so
    // the dialog never opened and the popup appeared blank. Build a lean chooser for all
    // breakpoints instead: product header (title + price), variant picker, add-to-cart.
    const productFormComponent = productGrid.querySelector('product-form-component');
    const variantPicker = productGrid.querySelector('variant-picker');
    const productPrice = productGrid.querySelector('product-price');

    const productTitle = document.createElement('a');
    productTitle.textContent = this.dataset.productTitle || '';
    // Make product title a link to the product page
    productTitle.href = this.productPageUrl;

    const productHeader = document.createElement('div');
    productHeader.classList.add('product-header');
    productHeader.appendChild(productTitle);
    if (productPrice) {
      productHeader.appendChild(productPrice);
    }

    const lean = document.createElement('div');
    lean.classList.add('product-details', 'quick-add-lean', 'sticky-content');
    lean.appendChild(productHeader);
    if (variantPicker) {
      lean.appendChild(variantPicker);
    }
    if (productFormComponent) {
      lean.appendChild(productFormComponent);
    }

    morph(modalContent, lean);

    this.#syncVariantSelection(modalContent);
  }

  /**
   * Updates the quick-add button state based on whether a swatch is selected
   * @param {VariantSelectedEvent} event - The variant selected event
   */
  #updateQuickAddButtonState(event) {
    if (!(event.target instanceof HTMLElement)) return;
    if (event.target.closest('product-card') !== this.closest('product-card')) return;
    const productOptionsCount = this.dataset.productOptionsCount;
    const quickAddButton = productOptionsCount === '1' ? 'add' : 'choose';
    this.setAttribute('data-quick-add-button', quickAddButton);
  }

  /**
   * Syncs the variant selection from the product card to the modal
   * @param {Element} modalContent - The modal content element
   */
  #syncVariantSelection(modalContent) {
    const selectedVariantId = this.#getSelectedVariantId();
    if (!selectedVariantId) return;

    // Find and check the corresponding input in the modal
    const modalInputs = modalContent.querySelectorAll('input[type="radio"][data-variant-id]');
    for (const input of modalInputs) {
      if (input instanceof HTMLInputElement && input.dataset.variantId === selectedVariantId && !input.checked) {
        input.checked = true;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }
}

if (!customElements.get('quick-add-component')) {
  customElements.define('quick-add-component', QuickAddComponent);
}

class QuickAddDialog extends DialogComponent {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, { signal: this.#abortController.signal });
    this.addEventListener(ThemeEvents.variantUpdate, this.#updateProductTitleLink);

    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  /**
   * Closes the dialog
   * @param {CartUpdateEvent} event - The cart update event
   */
  handleCartUpdate = (event) => {
    if (event.detail.data.didError) return;
    this.closeDialog();
  };

  #updateProductTitleLink = (/** @type {CustomEvent} */ event) => {
    const anchorElement = /** @type {HTMLAnchorElement} */ (
      event.detail.data.html?.querySelector('.view-product-title a')
    );
    const viewMoreDetailsLink = /** @type {HTMLAnchorElement} */ (this.querySelector('.view-product-title a'));
    const mobileProductTitle = /** @type {HTMLAnchorElement} */ (this.querySelector('.product-header a'));

    if (!anchorElement) return;

    if (viewMoreDetailsLink) viewMoreDetailsLink.href = anchorElement.href;
    if (mobileProductTitle) mobileProductTitle.href = anchorElement.href;
  };

  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    /**
     * This is a patch to solve an issue with the UI freezing when the dialog is closed.
     * To reproduce it, use iOS 16.0.
     */
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      /** @type {HTMLElement | null} */
      const grid = document.querySelector('#ResultsList [product-grid-view]');
      if (grid) {
        const currentWidth = grid.getBoundingClientRect().width;
        grid.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          grid.style.width = '';
        });
      }
    });
  };
}

if (!customElements.get('quick-add-dialog')) {
  customElements.define('quick-add-dialog', QuickAddDialog);
}

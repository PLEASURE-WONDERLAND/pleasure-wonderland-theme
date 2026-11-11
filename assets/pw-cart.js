/**
 * Pleasure Wonderland cart helper.
 * Adds one or more variants through the AJAX cart, then tells Horizon's cart
 * components about it so the cart drawer re-renders and opens in place.
 */
import { CartLinesUpdateEvent } from '@shopify/events';

const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';

function cartSectionIds() {
  const ids = [];
  document.querySelectorAll('cart-items-component').forEach((el) => {
    if (el instanceof HTMLElement && el.dataset.sectionId) ids.push(el.dataset.sectionId);
  });
  return [...new Set(ids)];
}

function openDrawer() {
  const drawer = /** @type {any} */ (document.getElementById('cart-drawer'));
  if (drawer && typeof drawer.open === 'function' && !drawer.isOpen) drawer.open();
}

/**
 * @param {{id: string|number, quantity?: number}[]} items
 * @param {Element} [source] element the add came from
 */
export async function pwAddToCart(items, source) {
  const clean = items.filter((i) => i && i.id).map((i) => ({ id: Number(i.id), quantity: i.quantity || 1 }));
  if (!clean.length) return;

  const sections = cartSectionIds();
  const deferred = CartLinesUpdateEvent.createPromise();
  const target = source || document.body;

  target.dispatchEvent(
    new CartLinesUpdateEvent({
      action: 'add',
      context: 'standard-action',
      lines: clean.map((i) => ({ merchandiseId: String(i.id), quantity: i.quantity })),
      promise: deferred.promise,
    })
  );

  try {
    const res = await fetch(root + 'cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: clean, sections: sections.join(','), sections_url: window.location.pathname }),
    });
    const data = await res.json();
    const cart = await fetch(root + 'cart.js', { headers: { Accept: 'application/json' } }).then((r) => r.json());

    if (!res.ok || data.status) {
      deferred.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: { didError: true, items: cart.items, source: 'pw-cart' },
      });
      throw new Error(data.description || data.message || 'Could not add to cart');
    }

    deferred.resolve({
      cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
      detail: { didError: false, items: cart.items, source: 'pw-cart', sections: data.sections },
    });
    openDrawer();
    return cart;
  } catch (error) {
    deferred.reject(error);
    throw error;
  }
}

window.pwAddToCart = pwAddToCart;

/* Any element with data-pw-add="variantId[,variantId]" becomes a one-tap add button. */
document.addEventListener('click', async (event) => {
  const btn = event.target instanceof Element ? event.target.closest('[data-pw-add]') : null;
  if (!btn || btn.hasAttribute('disabled')) return;
  event.preventDefault();
  const ids = String(btn.getAttribute('data-pw-add')).split(',').filter(Boolean);
  const label = btn.textContent;
  btn.setAttribute('disabled', '');
  btn.setAttribute('aria-busy', 'true');
  try {
    await pwAddToCart(ids.map((id) => ({ id })), btn);
  } catch (e) {
    btn.textContent = 'Try again';
    setTimeout(() => (btn.textContent = label), 2500);
  } finally {
    btn.removeAttribute('disabled');
    btn.removeAttribute('aria-busy');
  }
});

/* PW product-card quick add forms: add in place instead of leaving the page. */
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.matches('[data-pw-quick-add]')) return;
  event.preventDefault();
  const id = form.querySelector('[name="id"]');
  const btn = form.querySelector('button');
  if (btn) btn.setAttribute('disabled', '');
  try {
    await pwAddToCart([{ id: id && id.value }], form);
  } catch (e) {
    form.submit();
  } finally {
    if (btn) btn.removeAttribute('disabled');
  }
});

/* After a welcome signup, apply the code to the session so it lands in checkout automatically. */
document.querySelectorAll('[data-pw-apply-code]').forEach((el) => {
  const code = el.getAttribute('data-pw-apply-code');
  if (!code) return;
  fetch(root + 'discount/' + encodeURIComponent(code) + '?redirect=' + encodeURIComponent(root + 'cart.js'), { credentials: 'same-origin' }).catch(() => {});
});

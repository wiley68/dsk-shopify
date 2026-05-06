/**
 * DSK Credit API – модал с iframe за страница количка (масив продукти + обща сума).
 */

(function () {
  "use strict";

  const ALLOWED_ORIGIN = "https://dsk.avalon-bg.eu";
  const DSK_API_URL = `${ALLOWED_ORIGIN}/app/index.php`;
  const FIXED_IFRAME_HEIGHT = 800;

  /**
   * @returns {string}
   */
  function getShopifyRoot() {
    var shopify =
      typeof window !== "undefined"
        ? /** @type {{ routes?: { root?: string } } | undefined } */ (
            window["Shopify"]
          )
        : undefined;
    return shopify && shopify.routes && shopify.routes.root
      ? shopify.routes.root
      : "/";
  }

  /**
   * Конвертира цена в центове към десетичен низ (напр. 1234 -> "12.34").
   * @param {number} cents
   * @returns {string}
   */
  function centsToDecimalString(cents) {
    if (!Number.isFinite(cents) || cents <= 0) return "";
    return (cents / 100).toFixed(2);
  }

  /**
   * @param {{ product_title?: string; variant_title?: string }} item
   * @returns {string}
   */
  function buildProductTitle(item) {
    var title = item.product_title || "";
    var vt = item.variant_title;
    if (vt && vt !== "Default Title") {
      title = title ? title + " - " + vt : vt;
    }
    return title;
  }

  /**
   * Единична цена на артикул в центове (след отстъпки на ред, ако има).
   * @param {Record<string, unknown>} item
   * @returns {number}
   */
  function getLineUnitPriceCents(item) {
    if (
      typeof item.final_price === "number" &&
      Number.isFinite(item.final_price)
    ) {
      return item.final_price;
    }
    if (typeof item.price === "number" && Number.isFinite(item.price)) {
      return item.price;
    }
    return 0;
  }

  /**
   * @param {Record<string, unknown>} cart
   * @returns {{ products: Array<Record<string, string>>; cart_total_price: string }}
   */
  function buildProductsPayloadFromCart(cart) {
    /** @type {Array<Record<string, string>>} */
    var products = [];
    var items = cart && Array.isArray(cart.items) ? cart.items : [];

    for (var i = 0; i < items.length; i++) {
      var item = /** @type {Record<string, unknown>} */ (items[i]);
      var qty =
        typeof item.quantity === "number" && item.quantity > 0
          ? item.quantity
          : 1;
      var unitCents = getLineUnitPriceCents(item);
      products.push({
        product_id:
          item.product_id !== undefined && item.product_id !== null
            ? String(item.product_id)
            : "",
        product_title: buildProductTitle(
          /** @type {{ product_title?: string; variant_title?: string }} */ (
            item
          ),
        ),
        product_price: centsToDecimalString(unitCents),
        product_variant_id:
          item.variant_id !== undefined && item.variant_id !== null
            ? String(item.variant_id)
            : "",
        product_quantity: String(qty),
      });
    }

    var totalCents = getCartTotalCents(
      /** @type {Record<string, unknown>} */ (cart),
      items,
    );

    return {
      products: products,
      cart_total_price: centsToDecimalString(totalCents),
    };
  }

  /**
   * Обща сума на количката в центове (като Shopify – за вноски спрямо реалната сума).
   * @param {Record<string, unknown>} cart
   * @param {unknown[]} items
   * @returns {number}
   */
  function getCartTotalCents(cart, items) {
    if (
      typeof cart.total_price === "number" &&
      Number.isFinite(cart.total_price)
    ) {
      return cart.total_price;
    }
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      var it = /** @type {Record<string, unknown>} */ (items[i]);
      if (typeof it.final_line_price === "number") {
        sum += it.final_line_price;
      } else if (typeof it.line_price === "number") {
        sum += it.line_price;
      } else {
        var q =
          typeof it.quantity === "number" && it.quantity > 0
            ? it.quantity
            : 1;
        sum += getLineUnitPriceCents(it) * q;
      }
    }
    return sum;
  }

  /**
   * @returns {Promise<Record<string, unknown>>}
   */
  function fetchCartJson() {
    var root = getShopifyRoot();
    return fetch(root + "cart.js", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var container = document.getElementById("dskapi-cart-button-container");
    var btn = document.getElementById("btn_dskapi_cart");
    if (!container || !(btn instanceof HTMLButtonElement)) return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openDSKModal();
    });
  });

  function openDSKModal() {
    var container = document.getElementById("dskapi-cart-button-container");
    if (!(container instanceof HTMLElement)) return;

    fetchCartJson()
      .then(function (cart) {
        if (!(container instanceof HTMLElement)) return;

        var built = buildProductsPayloadFromCart(
          /** @type {Record<string, unknown>} */ (cart),
        );
        if (!built.products.length) {
          console.warn("DSK API (cart): празна количка");
          return;
        }

        var modal = document.getElementById("dskapi-modal");
        if (!modal) {
          modal = createModal();
          document.body.appendChild(modal);
        }

        var iframeContainer = modal.querySelector("#dskapi-iframe-container");
        if (!(iframeContainer instanceof HTMLElement)) {
          console.error("DSK API (cart): iframe container not found");
          return;
        }

        iframeContainer.style.height = FIXED_IFRAME_HEIGHT + "px";

        iframeContainer.innerHTML = getLoadingMarkup();

        var hasSubmittedToIframe = false;
        var iframe = document.createElement("iframe");
        iframe.name = "dskapi-iframe";
        iframe.id = "dskapi-iframe";
        iframe.className = "dskapi-iframe";
        iframe.frameBorder = "0";
        iframe.allow = "payment";

        iframe.onload = function () {
          if (!hasSubmittedToIframe) return;
          var modalRoot = document.getElementById("dskapi-modal");
          if (!(modalRoot instanceof HTMLElement)) return;
          var wrap = modalRoot.querySelector("#dskapi-iframe-container");
          if (!(wrap instanceof HTMLElement)) return;
          var loadingOverlay = wrap.querySelector(".dskapi-loading-overlay");
          if (loadingOverlay) loadingOverlay.remove();
        };

        iframeContainer.appendChild(iframe);

        modal.classList.add("dskapi-modal-active");
        document.body.style.overflow = "hidden";

        /** @type {Record<string, unknown>} */
        var payload = {
          products: built.products,
          cart_total_price: built.cart_total_price,
          shop_domain: container.dataset.shopDomain || window.location.hostname,
          shop_permanent_domain: container.dataset.shopPermanentDomain || "",
          cid: container.dataset.cid || "",
          ts: String(Math.floor(Date.now() / 1000)),
        };

        setTimeout(function () {
          var form = createPostForm(payload);
          document.body.appendChild(form);
          hasSubmittedToIframe = true;
          form.submit();
          setTimeout(function () {
            if (form.parentNode) form.parentNode.removeChild(form);
          }, 100);
        }, 100);
      })
      .catch(function (err) {
        console.error("DSK API (cart):", err);
      });
  }

  function createModal() {
    var modal = document.createElement("div");
    modal.id = "dskapi-modal";
    modal.className = "dskapi-modal";
    modal.innerHTML = `
      <div class="dskapi-modal-overlay"></div>
      <div class="dskapi-modal-content">
        <button class="dskapi-modal-close" aria-label="Затвори">&times;</button>
        <div id="dskapi-iframe-container" class="dskapi-iframe-container">
          ${getLoadingMarkup()}
        </div>
      </div>
    `;

    var overlay = modal.querySelector(".dskapi-modal-overlay");
    var closeBtn = modal.querySelector(".dskapi-modal-close");
    if (overlay) overlay.addEventListener("click", closeModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    document.addEventListener("keydown", function (e) {
      if (
        e.key === "Escape" &&
        modal.classList.contains("dskapi-modal-active")
      ) {
        closeModal();
      }
    });

    return modal;
  }

  function getLoadingMarkup() {
    return `
      <div class="dskapi-loading-overlay" role="status" aria-live="polite">
        <div class="dskapi-loading-spinner" aria-hidden="true"></div>
        <div class="dskapi-loading-text">Зареждане на калкулатора...</div>
      </div>
    `;
  }

  /**
   * @param {Record<string, unknown>} data
   */
  function createPostForm(data) {
    var form = document.createElement("form");
    form.method = "POST";
    form.action = DSK_API_URL;
    form.target = "dskapi-iframe";
    form.style.display = "none";

    Object.keys(data).forEach(function (key) {
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      var rawValue = data[key];
      if (rawValue === null || rawValue === undefined) {
        input.value = "";
      } else if (typeof rawValue === "object") {
        input.value = JSON.stringify(rawValue);
      } else {
        input.value = String(rawValue);
      }
      form.appendChild(input);
    });

    return form;
  }

  function closeModal() {
    var modal = document.getElementById("dskapi-modal");
    if (modal) {
      modal.classList.remove("dskapi-modal-active");
      document.body.style.overflow = "";
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (!data || data.source !== "dskapi-iframe") return;
    if (event.origin !== ALLOWED_ORIGIN) return;
    if (data.type === "DSKAPI_CLOSE_MODAL") {
      closeModal();
    }
  });

  if (typeof window !== "undefined") {
    /** @type {any} */
    var win = window;
    win.DSKAPICart = {
      open: openDSKModal,
      close: closeModal,
    };
  }
})();

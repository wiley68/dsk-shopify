/**
 * DSK Credit API – JavaScript за модал с iframe
 */

(function () {
  "use strict";

  // Конфигурация
  const ALLOWED_ORIGIN = "https://dsk.avalon-bg.eu";
  const DSK_API_URL = `${ALLOWED_ORIGIN}/app/index.php`;
  const FIXED_IFRAME_HEIGHT = 800;
  const MAX_PRODUCT_QUANTITY = 9999;
  const VARIANT_PRICE_CACHE_DURATION_MS = 5 * 60 * 1000;
  /** @type {Map<string, { price: number, timestamp: number }>} */
  const variantPriceCache = new Map();

  /**
   * Връща избрания variant ID от продуктова форма (ако има), иначе fallback от data-атрибут.
   * @param {HTMLElement} container
   * @returns {string}
   */
  function readSelectedVariantId(container) {
    var fallbackVariantId = container.dataset.productVariantId || "";
    var form =
      document.querySelector('form[action*="/cart/add"]') ||
      document.querySelector("form.product-form") ||
      document.querySelector('[id^="product-form"]');
    var variantInput =
      (form && form.querySelector('input[name="id"]')) ||
      document.querySelector('input[name="id"]');
    if (variantInput instanceof HTMLInputElement && variantInput.value !== "") {
      return String(variantInput.value).trim();
    }
    var variantSelect =
      (form && form.querySelector('select[name="id"]')) ||
      document.querySelector('select[name="id"]');
    if (
      variantSelect instanceof HTMLSelectElement &&
      variantSelect.value !== ""
    ) {
      return String(variantSelect.value).trim();
    }
    return fallbackVariantId;
  }

  /**
   * Извлича цена на variant от Shopify AJAX API (в центове).
   * @param {string} variantId
   * @returns {Promise<number>}
   */
  function getVariantPriceFromAPI(variantId) {
    if (!variantId) return Promise.resolve(0);
    var cached = variantPriceCache.get(variantId);
    var now = Date.now();
    if (cached && now - cached.timestamp < VARIANT_PRICE_CACHE_DURATION_MS) {
      return Promise.resolve(cached.price);
    }

    var shopify =
      typeof window !== "undefined"
        ? /** @type {{ routes?: { root?: string } } | undefined } */ (
            window["Shopify"]
          )
        : undefined;
    var shopifyRoot =
      shopify && shopify.routes && shopify.routes.root
        ? shopify.routes.root
        : "/";
    var variantUrl =
      shopifyRoot + "variants/" + encodeURIComponent(variantId) + ".js";

    return fetch(variantUrl)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (variantData) {
        var price =
          variantData && typeof variantData.price === "number"
            ? variantData.price
            : 0;
        if (price > 0) {
          variantPriceCache.set(variantId, { price: price, timestamp: now });
          return price;
        }
        return 0;
      })
      .catch(function () {
        return 0;
      });
  }

  /**
   * Конвертира цена в центове към десетичен формат (напр. 1234 -> "12.34").
   * @param {number} cents
   * @returns {string}
   */
  function centsToDecimalString(cents) {
    if (!Number.isFinite(cents) || cents <= 0) return "";
    return (cents / 100).toFixed(2);
  }

  /**
   * Чете избраното количество от формата за добавяне в количката (ако има такава).
   * Поддържа типични Shopify теми; при липса на поле връща data-product-quantity-default или 1.
   * @param {HTMLElement} container
   * @returns {string}
   */
  function readProductQuantity(container) {
    var defaultRaw =
      container.dataset.productQuantityDefault ||
      container.dataset.productQuantity ||
      "1";
    var defaultQty = parseInt(String(defaultRaw).trim(), 10);
    if (!Number.isFinite(defaultQty) || defaultQty < 1) {
      defaultQty = 1;
    }

    var form =
      document.querySelector('form[action*="/cart/add"]') ||
      document.querySelector("form.product-form") ||
      document.querySelector('[id^="product-form"]');
    var input = form
      ? form.querySelector('input[name="quantity"]:not([type="hidden"])')
      : null;
    if (!input) {
      input = document.querySelector(
        'input[name="quantity"]:not([type="hidden"])',
      );
    }
    var select =
      (form && form.querySelector('select[name="quantity"]')) ||
      document.querySelector('select[name="quantity"]');
    var rawValue = "";
    if (input instanceof HTMLInputElement && input.value !== "") {
      rawValue = String(input.value).trim();
    } else if (select instanceof HTMLSelectElement && select.value !== "") {
      rawValue = String(select.value).trim();
    }
    if (rawValue === "") {
      return String(Math.min(defaultQty, MAX_PRODUCT_QUANTITY));
    }
    var parsed = parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return String(Math.min(defaultQty, MAX_PRODUCT_QUANTITY));
    }
    return String(Math.min(parsed, MAX_PRODUCT_QUANTITY));
  }

  // Инициализация при зареждане на страницата
  document.addEventListener("DOMContentLoaded", function () {
    const btn = document.getElementById("btn_dskapi");
    if (!btn) return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openDSKModal();
    });
  });

  /**
   * Отваря модала с iframe и изпраща POST данни
   */
  function openDSKModal() {
    // Създаване на модал структурата ако не съществува
    let modal = document.getElementById("dskapi-modal");
    if (!modal) {
      modal = createModal();
      document.body.appendChild(modal);
    }

    // Получаване на данните за продукта от data атрибутите
    const container = document.getElementById(
      "dskapi-product-button-container",
    );
    if (!container) return;

    var selectedVariantId = readSelectedVariantId(container);
    const productData = {
      product_id: container.dataset.productId || "",
      product_title: container.dataset.productTitle || "",
      product_price: container.dataset.productPrice || "",
      product_variant_id: selectedVariantId,
      product_quantity: readProductQuantity(container),
      shop_domain: container.dataset.shopDomain || window.location.hostname,
      shop_permanent_domain: container.dataset.shopPermanentDomain || "",
      cid: container.dataset.cid || "",
      ts: String(Math.floor(Date.now() / 1000)), // Unix timestamp в секунди като string
    };

    // Изчистване на iframe контейнера
    const iframeContainer = modal.querySelector("#dskapi-iframe-container");
    if (!iframeContainer) {
      console.error("DSK API: iframe container not found");
      return;
    }
    if (iframeContainer instanceof HTMLElement) {
      iframeContainer.style.height = FIXED_IFRAME_HEIGHT + "px";
    }

    iframeContainer.innerHTML =
      '<div class="dskapi-loading">Зареждане...</div>';

    // Първо създаваме и добавяме iframe-а
    const iframe = document.createElement("iframe");
    iframe.name = "dskapi-iframe";
    iframe.id = "dskapi-iframe";
    iframe.className = "dskapi-iframe";
    iframe.frameBorder = "0";
    iframe.allow = "payment";

    // Премахване на loading индикатора когато iframe се зареди
    iframe.onload = function () {
      const loading = iframeContainer.querySelector(".dskapi-loading");
      if (loading) {
        loading.remove();
      }
    };

    // Добавяне на iframe-а в контейнера
    iframeContainer.appendChild(iframe);

    // Показване на модала ПРЕДИ да изпратим формата
    modal.classList.add("dskapi-modal-active");
    document.body.style.overflow = "hidden";

    // Изчакване малко за да се зареди iframe-ът в DOM
    setTimeout(function () {
      getVariantPriceFromAPI(selectedVariantId).then(
        function (variantPriceCents) {
          var variantPriceDecimal = centsToDecimalString(variantPriceCents);
          if (variantPriceDecimal !== "") {
            productData.product_price = variantPriceDecimal;
          }

          // Създаване на скрита форма за POST изпращане
          const form = createPostForm(productData);

          // Добавяне на формата в body (не в контейнера)
          document.body.appendChild(form);

          // Изпращане на формата (това ще зареди iframe-а с POST данни)
          form.submit();

          // Премахване на формата след изпращане
          setTimeout(function () {
            if (form.parentNode) {
              form.parentNode.removeChild(form);
            }
          }, 100);
        },
      );
    }, 100);
  }

  /**
   * Създава HTML структурата на модала
   */
  function createModal() {
    const modal = document.createElement("div");
    modal.id = "dskapi-modal";
    modal.className = "dskapi-modal";

    modal.innerHTML = `
      <div class="dskapi-modal-overlay"></div>
      <button class="dskapi-modal-close" aria-label="Затвори">&times;</button>
      <div class="dskapi-modal-content">
        <div id="dskapi-iframe-container" class="dskapi-iframe-container">
          <div class="dskapi-loading">Зареждане...</div>
        </div>
      </div>
    `;

    // Затваряне при клик на overlay или бутон за затваряне
    const overlay = modal.querySelector(".dskapi-modal-overlay");
    const closeBtn = modal.querySelector(".dskapi-modal-close");

    if (overlay) {
      overlay.addEventListener("click", closeModal);
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", closeModal);
    }

    // Затваряне с ESC клавиш
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

  /**
   * Създава скрита форма за POST изпращане към iframe
   * @param {Record<string, string>} data - Данни за продукта
   */
  function createPostForm(data) {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = DSK_API_URL;
    form.target = "dskapi-iframe";
    form.style.display = "none";

    // Добавяне на полетата
    Object.keys(data).forEach(function (key) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = key;
      /** @type {any} */
      const dataObj = data;
      input.value = String(dataObj[key] || "");
      form.appendChild(input);
    });

    return form;
  }

  /**
   * Затваря модала
   */
  function closeModal() {
    const modal = document.getElementById("dskapi-modal");
    if (modal) {
      modal.classList.remove("dskapi-modal-active");
      document.body.style.overflow = "";
    }
  }

  window.addEventListener("message", function (event) {
    var data = event.data || {};
    if (!data || data.source !== "dskapi-iframe") {
      return;
    }
    if (event.origin !== ALLOWED_ORIGIN) {
      return;
    }
    if (data.type === "DSKAPI_CLOSE_MODAL") {
      closeModal();
      return;
    }
  });

  // Експорт на функциите за глобална употреба (ако е необходимо)
  if (typeof window !== "undefined") {
    /** @type {any} */
    (window).DSKAPI = {
      open: openDSKModal,
      close: closeModal,
    };
  }
})();

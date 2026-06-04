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
  const OUT_OF_STOCK_TEXT_PATTERN =
    /(sold\s*out|out\s*of\s*stock|изчерпан|изчерпано|неналичен|неналична)/i;
  /** @type {Map<string, { price: number, title: string, timestamp: number }>} */
  const variantInfoCache = new Map();

  /**
   * Намира основната продуктова форма (Horizon, Dawn и други OS 2.0 теми).
   * @returns {HTMLFormElement | null}
   */
  function findProductForm() {
    var form =
      document.querySelector('form[action*="/cart/add"]') ||
      document.querySelector('form[action*="cart/add"]') ||
      document.querySelector("form.product-form") ||
      document.querySelector('form[data-type="add-to-cart-form"]') ||
      document.querySelector('[id^="product-form"]');
    return form instanceof HTMLFormElement ? form : null;
  }

  /**
   * Чете избрания вариант от Dawn script[data-selected-variant] (обновява се от VariantSelects).
   * @returns {{ id?: number|string } | null}
   */
  function getSelectedVariantFromDom() {
    var script = document.querySelector(
      'script[type="application/json"][data-selected-variant]',
    );
    if (!script) return null;
    try {
      var data = JSON.parse(script.textContent || "{}");
      return data && data.id ? data : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Проверява дали елементът е контрол за избор на вариант (radio, select или hidden id).
   * @param {EventTarget | null} target
   * @returns {boolean}
   */
  function isProductVariantOptionTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target instanceof HTMLInputElement && target.type === "radio") {
      var radioName = target.name || "";
      return (
        radioName.includes("Color") ||
        radioName.includes("Size") ||
        radioName.includes("variant") ||
        radioName.includes("option")
      );
    }
    if (target instanceof HTMLSelectElement) {
      var selectName = target.name || "";
      return (
        selectName.indexOf("options[") === 0 || selectName.includes("option")
      );
    }
    if (target instanceof HTMLInputElement && target.name === "id") {
      return !!target.closest(
        'form[action*="cart/add"], form[data-type="add-to-cart-form"]',
      );
    }
    return false;
  }

  /**
   * Връща избрания variant ID от продуктова форма (ако има), иначе fallback от data-атрибут.
   * @param {HTMLElement} container
   * @returns {string}
   */
  function readSelectedVariantId(container) {
    var fallbackVariantId = container.dataset.productVariantId || "";
    var form = findProductForm();
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
    var selectedVariant = getSelectedVariantFromDom();
    if (selectedVariant && selectedVariant.id) {
      return String(selectedVariant.id).trim();
    }
    var checkedRadio = document.querySelector(
      'input[type="radio"][name*="variant"]:checked, input[type="radio"][name*="Color"]:checked, input[type="radio"][name*="Size"]:checked',
    );
    if (checkedRadio instanceof HTMLInputElement) {
      var radioVariantId = checkedRadio.getAttribute("data-variant-id");
      if (radioVariantId) return String(radioVariantId).trim();
    }
    return fallbackVariantId;
  }

  /**
   * Извлича данни за variant от Shopify AJAX API – цена (в центове) и title.
   * @param {string} variantId
   * @returns {Promise<{ price: number, title: string }>}
   */
  function getVariantInfoFromAPI(variantId) {
    if (!variantId) return Promise.resolve({ price: 0, title: "" });
    var cached = variantInfoCache.get(variantId);
    var now = Date.now();
    if (cached && now - cached.timestamp < VARIANT_PRICE_CACHE_DURATION_MS) {
      return Promise.resolve({ price: cached.price, title: cached.title });
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
        var title =
          variantData && typeof variantData.title === "string"
            ? variantData.title
            : "";
        if (price > 0 || title !== "") {
          variantInfoCache.set(variantId, {
            price: price,
            title: title,
            timestamp: now,
          });
        }
        return { price: price, title: title };
      })
      .catch(function () {
        return { price: 0, title: "" };
      });
  }

  /**
   * Конкатенира името на продукта с името на варианта (ако не е "Default Title").
   * Същата логика като в snippets/dsk-cart-button.js, за консистентност.
   * @param {string} productTitle
   * @param {string} variantTitle
   * @returns {string}
   */
  function buildProductTitle(productTitle, variantTitle) {
    var base = productTitle || "";
    if (variantTitle && variantTitle !== "Default Title") {
      return base ? base + " - " + variantTitle : variantTitle;
    }
    return base;
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

    var form = findProductForm();
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
    const container = document.getElementById(
      "dskapi-product-button-container",
    );
    const btn = document.getElementById("btn_dskapi");
    if (!container || !(btn instanceof HTMLButtonElement)) return;

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      openDSKModal();
    });

    setupAvailabilitySync(container, btn);
  });

  /**
   * Опитва да намери основния бутон за добавяне в количката.
   * @returns {HTMLButtonElement | HTMLInputElement | null}
   */
  function findPrimaryAddToCartButton() {
    var form = findProductForm();
    if (!form) return null;
    var addButton = form.querySelector(
      'button[type="submit"], input[type="submit"]',
    );
    if (
      addButton instanceof HTMLButtonElement ||
      addButton instanceof HTMLInputElement
    ) {
      return addButton;
    }
    return null;
  }

  /**
   * Връща true, ако Add to cart е в неактивно/неналично състояние.
   * @param {HTMLButtonElement | HTMLInputElement | null} addButton
   * @returns {boolean}
   */
  function isAddToCartUnavailable(addButton) {
    if (!addButton) return false;
    if (addButton.disabled) return true;
    var ariaDisabled = addButton.getAttribute("aria-disabled");
    if (ariaDisabled === "true") return true;
    var label =
      addButton instanceof HTMLInputElement
        ? addButton.value || ""
        : addButton.textContent || "";
    return OUT_OF_STOCK_TEXT_PATTERN.test(label);
  }

  /**
   * Синхронизира DSK бутона с наличността на основния бутон.
   * @param {HTMLElement} container
   * @param {HTMLButtonElement} dskBtn
   */
  function syncAvailabilityState(container, dskBtn) {
    var addToCartBtn = findPrimaryAddToCartButton();
    var unavailable = isAddToCartUnavailable(addToCartBtn);
    var shouldHide = unavailable;

    container.style.display = shouldHide ? "none" : "";
    dskBtn.disabled = unavailable;
    dskBtn.setAttribute("aria-disabled", unavailable ? "true" : "false");
  }

  /**
   * Следи промени по продуктовата форма и синхронизира DSK бутона.
   * @param {HTMLElement} container
   * @param {HTMLButtonElement} dskBtn
   */
  function setupAvailabilitySync(container, dskBtn) {
    syncAvailabilityState(container, dskBtn);

    var form = findProductForm();

    var scheduleSync = function () {
      window.setTimeout(function () {
        syncAvailabilityState(container, dskBtn);
      }, 0);
    };

    var scheduleSyncDelayed = function () {
      window.setTimeout(function () {
        syncAvailabilityState(container, dskBtn);
      }, 150);
    };

    if (form) {
      form.addEventListener("change", scheduleSync);
      form.addEventListener("input", scheduleSync);

      var observer = new MutationObserver(scheduleSync);
      observer.observe(form, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["disabled", "aria-disabled", "class", "value"],
      });
    }

    // Dawn: select options[], Horizon: radio – change събития на document (capture)
    document.addEventListener(
      "change",
      function (event) {
        if (isProductVariantOptionTarget(event.target)) {
          scheduleSyncDelayed();
        }
      },
      true,
    );

    document.addEventListener(
      "click",
      function (event) {
        var target = event.target;
        if (
          target instanceof HTMLInputElement &&
          target.type === "radio" &&
          isProductVariantOptionTarget(target)
        ) {
          scheduleSyncDelayed();
        }
      },
      true,
    );

    setupVariantChangeObserver(scheduleSyncDelayed);
  }

  /**
   * Следи input[name="id"] и script[data-selected-variant] – Dawn обновява variant без radio.
   * @param {function(): void} onVariantChange
   */
  function setupVariantChangeObserver(onVariantChange) {
    var idInput = document.querySelector(
      'form[action*="cart/add"] input[name="id"], form[data-type="add-to-cart-form"] input[name="id"]',
    );
    if (idInput instanceof HTMLInputElement) {
      var lastVariantId = idInput.value || "";
      var onIdChange = function () {
        var currentId = idInput.value || "";
        if (currentId && currentId !== lastVariantId) {
          lastVariantId = currentId;
          onVariantChange();
        }
      };
      idInput.addEventListener("change", onIdChange);
      new MutationObserver(onIdChange).observe(idInput, {
        attributes: true,
        attributeFilter: ["value"],
      });
    }

    var selectedScript = document.querySelector(
      'script[type="application/json"][data-selected-variant]',
    );
    if (selectedScript) {
      var lastScriptContent = selectedScript.textContent || "";
      new MutationObserver(function () {
        var currentContent = selectedScript.textContent || "";
        if (currentContent && currentContent !== lastScriptContent) {
          lastScriptContent = currentContent;
          onVariantChange();
        }
      }).observe(selectedScript, {
        characterData: true,
        childList: true,
        subtree: true,
      });
    }
  }

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
      products: [
        {
          product_id: container.dataset.productId || "",
          product_title: container.dataset.productTitle || "",
          product_price: container.dataset.productPrice || "",
          product_variant_id: selectedVariantId,
          product_quantity: readProductQuantity(container),
        },
      ],
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

    iframeContainer.innerHTML = getLoadingMarkup();

    // Първо създаваме и добавяме iframe-а
    var hasSubmittedToIframe = false;
    const iframe = document.createElement("iframe");
    iframe.name = "dskapi-iframe";
    iframe.id = "dskapi-iframe";
    iframe.className = "dskapi-iframe";
    iframe.frameBorder = "0";
    iframe.allow = "payment";

    // Премахване на loading индикатора само след реално POST зареждане.
    // Iframe може да върне initial onload преди submit (about:blank).
    iframe.onload = function () {
      if (!hasSubmittedToIframe) {
        return;
      }
      const loadingOverlay = iframeContainer.querySelector(
        ".dskapi-loading-overlay",
      );
      if (loadingOverlay) {
        loadingOverlay.remove();
      }
    };

    // Добавяне на iframe-а в контейнера
    iframeContainer.appendChild(iframe);

    // Показване на модала ПРЕДИ да изпратим формата
    modal.classList.add("dskapi-modal-active");
    document.body.style.overflow = "hidden";

    // Изчакване малко за да се зареди iframe-ът в DOM
    setTimeout(function () {
      getVariantInfoFromAPI(selectedVariantId).then(function (variantInfo) {
        var variantPriceDecimal = centsToDecimalString(variantInfo.price);
        var combinedTitle = buildProductTitle(
          container.dataset.productTitle || "",
          variantInfo.title,
        );
        if (
          Array.isArray(productData.products) &&
          productData.products.length > 0
        ) {
          var firstProduct = productData.products[0];
          if (firstProduct) {
            if (variantPriceDecimal !== "") {
              firstProduct.product_price = variantPriceDecimal;
            }
            if (combinedTitle !== "") {
              firstProduct.product_title = combinedTitle;
            }
          }
        }

        // Създаване на скрита форма за POST изпращане
        const form = createPostForm(productData);

        // Добавяне на формата в body (не в контейнера)
        document.body.appendChild(form);

        // Изпращане на формата (това ще зареди iframe-а с POST данни)
        hasSubmittedToIframe = true;
        form.submit();

        // Премахване на формата след изпращане
        setTimeout(function () {
          if (form.parentNode) {
            form.parentNode.removeChild(form);
          }
        }, 100);
      });
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
      <div class="dskapi-modal-content">
        <button class="dskapi-modal-close" aria-label="Затвори">&times;</button>
        <div id="dskapi-iframe-container" class="dskapi-iframe-container">
          ${getLoadingMarkup()}
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
   * Маркъп за loading overlay върху iframe контейнера.
   * @returns {string}
   */
  function getLoadingMarkup() {
    return `
      <div class="dskapi-loading-overlay" role="status" aria-live="polite">
        <div class="dskapi-loading-spinner" aria-hidden="true"></div>
        <div class="dskapi-loading-text">Зареждане на калкулатора...</div>
      </div>
    `;
  }

  /**
   * Създава скрита форма за POST изпращане към iframe
   * @param {Record<string, unknown>} data - Данни за продукта
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
      const rawValue = dataObj[key];
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

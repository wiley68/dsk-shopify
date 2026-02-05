/**
 * DSK Credit API – JavaScript за модал с iframe
 */

(function() {
  'use strict';

  // Конфигурация
  const DSK_API_URL = 'https://dsk.avalon-bg.eu/app/index.php';
  
  // Инициализация при зареждане на страницата
  document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('btn_dskapi');
    if (!btn) return;

    btn.addEventListener('click', function(e) {
      e.preventDefault();
      openDSKModal();
    });
  });

  /**
   * Отваря модала с iframe и изпраща POST данни
   */
  function openDSKModal() {
    // Създаване на модал структурата ако не съществува
    let modal = document.getElementById('dskapi-modal');
    if (!modal) {
      modal = createModal();
      document.body.appendChild(modal);
    }

    // Получаване на данните за продукта от data атрибутите
    const container = document.getElementById('dskapi-product-button-container');
    if (!container) return;

    const productData = {
      product_id: container.dataset.productId || '',
      product_title: container.dataset.productTitle || '',
      product_price: container.dataset.productPrice || '',
      product_variant_id: container.dataset.productVariantId || '',
      shop_domain: container.dataset.shopDomain || window.location.hostname,
      cid: container.dataset.cid || ''
    };

    // Изчистване на iframe контейнера
    const iframeContainer = modal.querySelector('#dskapi-iframe-container');
    if (!iframeContainer) {
      console.error('DSK API: iframe container not found');
      return;
    }
    
    iframeContainer.innerHTML = '<div class="dskapi-loading">Зареждане...</div>';
    
    // Първо създаваме и добавяме iframe-а
    const iframe = document.createElement('iframe');
    iframe.name = 'dskapi-iframe';
    iframe.id = 'dskapi-iframe';
    iframe.className = 'dskapi-iframe';
    iframe.frameBorder = '0';
    iframe.allow = 'payment';
    
    // Премахване на loading индикатора когато iframe се зареди
    iframe.onload = function() {
      const loading = iframeContainer.querySelector('.dskapi-loading');
      if (loading) {
        loading.remove();
      }
    };
    
    // Добавяне на iframe-а в контейнера
    iframeContainer.appendChild(iframe);
    
    // Показване на модала ПРЕДИ да изпратим формата
    modal.classList.add('dskapi-modal-active');
    document.body.style.overflow = 'hidden';

    // Изчакване малко за да се зареди iframe-ът в DOM
    setTimeout(function() {
      // Създаване на скрита форма за POST изпращане
      const form = createPostForm(productData);
      
      // Добавяне на формата в body (не в контейнера)
      document.body.appendChild(form);
      
      // Изпращане на формата (това ще зареди iframe-а с POST данни)
      form.submit();
      
      // Премахване на формата след изпращане
      setTimeout(function() {
        if (form.parentNode) {
          form.parentNode.removeChild(form);
        }
      }, 100);
    }, 100);
  }

  /**
   * Създава HTML структурата на модала
   */
  function createModal() {
    const modal = document.createElement('div');
    modal.id = 'dskapi-modal';
    modal.className = 'dskapi-modal';
    
    modal.innerHTML = `
      <div class="dskapi-modal-overlay"></div>
      <div class="dskapi-modal-content">
        <button class="dskapi-modal-close" aria-label="Затвори">&times;</button>
        <div id="dskapi-iframe-container" class="dskapi-iframe-container">
          <div class="dskapi-loading">Зареждане...</div>
        </div>
      </div>
    `;

    // Затваряне при клик на overlay или бутон за затваряне
    const overlay = modal.querySelector('.dskapi-modal-overlay');
    const closeBtn = modal.querySelector('.dskapi-modal-close');
    
    if (overlay) {
      overlay.addEventListener('click', closeModal);
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', closeModal);
    }
    
    // Затваряне с ESC клавиш
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && modal.classList.contains('dskapi-modal-active')) {
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
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = DSK_API_URL;
    form.target = 'dskapi-iframe';
    form.style.display = 'none';

    // Добавяне на полетата
    Object.keys(data).forEach(function(key) {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      /** @type {any} */
      const dataObj = data;
      input.value = String(dataObj[key] || '');
      form.appendChild(input);
    });

    return form;
  }

  /**
   * Затваря модала
   */
  function closeModal() {
    const modal = document.getElementById('dskapi-modal');
    if (modal) {
      modal.classList.remove('dskapi-modal-active');
      document.body.style.overflow = '';
    }
  }

  // Експорт на функциите за глобална употреба (ако е необходимо)
  if (typeof window !== 'undefined') {
    /** @type {any} */
    (window).DSKAPI = {
      open: openDSKModal,
      close: closeModal
    };
  }

})();

(function () {
  function formatMoney(cents) {
    var currency = (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || undefined;
    try {
      return new Intl.NumberFormat(document.documentElement.lang || undefined, {
        style: "currency",
        currency: currency,
      }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(2);
    }
  }

  function productForm(widget) {
    var section = widget.closest("section, .shopify-section") || document;
    return section.querySelector('form[action*="/cart/add"]') || document.querySelector('form[action*="/cart/add"]');
  }

  function init(widget) {
    if (widget.dataset.bbReady) return;
    widget.dataset.bbReady = "true";

    var prices = {};
    var pricesEl = widget.querySelector("[data-bb-variant-prices]");
    try {
      prices = JSON.parse(pricesEl ? pricesEl.textContent : "{}");
    } catch (e) {
      prices = {};
    }
    var sameCurrency = widget.dataset.sameCurrency === "true";
    var form = productForm(widget);
    var selected = null; // the chosen tier button

    // Price per item on a tier (cents), or null when it can't be shown.
    function tierUnitPrice(offerType, value, price) {
      if (offerType === "percentage") return Math.round((price * (100 - value)) / 100);
      return sameCurrency ? Math.max(0, price - Math.round(value * 100)) : null;
    }

    // ---------------------------------------------------------------------
    // The theme's own product price ("$15.00" under the title) follows the
    // chosen tier: "<s>$15.00</s> $13.50". Themes mark up prices differently,
    // so it's found by its amount: the visible price element in the product
    // section (outside this widget) that shows the variant's price. If none
    // matches, the theme's price is left alone.
    // ---------------------------------------------------------------------
    var PRICE_SELECTOR =
      'product-price, .price, .price-item, [id^="price-"], [data-product-price], [data-price], .product__price, .product-price, .product-single__price';
    var section = widget.closest(".shopify-section, section") || document;
    var themePrice = null; // { el, html } while it shows the tier price
    var applying = false;

    function digitsOf(text) {
      return String(text || "").replace(/[^0-9]/g, "");
    }

    function showsPrice(el, cents) {
      var digits = digitsOf(el.textContent);
      if (!digits) return false;
      var asNumber = parseInt(digits, 10);
      // "$15.00" -> 1500 cents; "15 €" / "Rs. 1,500" -> whole units.
      return asNumber === cents || (cents % 100 === 0 && asNumber === cents / 100);
    }

    function isVisible(el) {
      return Boolean(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    }

    function findThemePrice(cents) {
      var candidates = Array.prototype.filter.call(section.querySelectorAll(PRICE_SELECTOR), function (el) {
        return !widget.contains(el) && !el.closest("[data-bb-breaks]") && isVisible(el) && showsPrice(el, cents);
      });
      // The innermost match: the element that holds just the amount.
      return (
        candidates.find(function (el) {
          return !candidates.some(function (other) {
            return other !== el && el.contains(other);
          });
        }) || null
      );
    }

    function restoreThemePrice() {
      if (!themePrice) return;
      // Only if it still shows our price: never overwrite the theme's own update.
      if (themePrice.el.isConnected && themePrice.el.querySelector(".bb-theme-price__now")) {
        applying = true;
        themePrice.el.innerHTML = themePrice.html;
        applying = false;
      }
      themePrice = null;
    }

    function renderThemePrice(variantId) {
      var price = prices[variantId];
      var offer = selected && selected.closest("[data-bb-offer]");
      restoreThemePrice();
      if (!selected || !offer || offer.hidden || price === undefined) return;
      var unit = tierUnitPrice(offer.dataset.type, parseFloat(selected.dataset.value), price);
      if (unit === null || unit >= price) return;
      var el = findThemePrice(price);
      if (!el) return;
      themePrice = { el: el, html: el.innerHTML };
      applying = true;
      el.textContent = "";
      var was = document.createElement("s");
      was.className = "bb-theme-price__was";
      was.textContent = formatMoney(price);
      var now = document.createElement("span");
      now.className = "bb-theme-price__now";
      now.textContent = formatMoney(unit);
      el.appendChild(was);
      el.appendChild(document.createTextNode(" "));
      el.appendChild(now);
      el.setAttribute("data-bb-tier-price", "");
      applying = false;
    }

    function currentVariantId() {
      var idInput = form && form.querySelector('[name="id"]');
      return idInput && idInput.value ? String(idInput.value) : widget.dataset.variantId;
    }

    // Themes re-render the price when the variant changes; show the tier
    // price again on the new markup.
    if (window.MutationObserver && section !== document) {
      var pending = false;
      new MutationObserver(function () {
        if (applying || pending || !selected) return;
        if (themePrice && themePrice.el.isConnected && themePrice.el.hasAttribute("data-bb-tier-price")) return;
        pending = true;
        window.requestAnimationFrame(function () {
          pending = false;
          themePrice = null; // the theme replaced it
          renderThemePrice(currentVariantId());
        });
      }).observe(section, { childList: true, subtree: true, characterData: true });
    }

    function update(variantId) {
      var price = prices[variantId];
      widget.querySelectorAll("[data-bb-offer]").forEach(function (offer) {
        var variants = offer.dataset.variants ? offer.dataset.variants.split(",") : [];
        // Subscription-only / one-time-only offers follow the purchase choice
        // (set by the purchase options below; unknown when they aren't shown).
        var purchase = offer.dataset.purchase || "both";
        var mode = widget.dataset.bbPurchaseMode;
        var wrongPurchase = Boolean(mode) && purchase !== "both" && purchase !== mode;
        offer.hidden = (variants.length > 0 && variants.indexOf(String(variantId)) === -1) || wrongPurchase;
        if (price === undefined) return;
        offer.querySelectorAll("[data-bb-tier]").forEach(function (tier) {
          var priceEl = tier.querySelector("[data-bb-amount]");
          if (!priceEl) return;
          var tierPrice = tierUnitPrice(offer.dataset.type, parseFloat(tier.dataset.value), price);
          if (tierPrice !== null) priceEl.textContent = formatMoney(tierPrice);
        });
      });
      renderThemePrice(variantId);
    }

    widget.addEventListener("click", function (event) {
      var tier = event.target.closest("[data-bb-tier]");
      if (!tier) return;
      widget.querySelectorAll("[data-bb-tier]").forEach(function (other) {
        other.setAttribute("aria-pressed", other === tier ? "true" : "false");
      });
      selected = tier;
      var quantityInput = form && form.querySelector('input[name="quantity"]');
      if (quantityInput) {
        quantityInput.value = tier.dataset.qty;
        quantityInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      renderThemePrice(currentVariantId());
    });

    if (form) {
      var idInput = form.querySelector('[name="id"]');
      if (idInput) {
        form.addEventListener("change", function () {
          update(idInput.value);
        });
      }
    }

    widget.querySelectorAll("[data-bb-tier]").forEach(function (tier) {
      tier.setAttribute("aria-pressed", "false");
    });

    setupPurchaseOptions(widget, form, prices, update);
  }

  // One-time purchase vs. subscription (Shopify selling plans). The chosen
  // plan goes into the product form's `selling_plan` input, so Add to cart
  // adds the subscription; one-time clears it.
  function setupPurchaseOptions(widget, form, prices, refreshOffers) {
    var plans = widget.querySelector("[data-bb-purchase]");
    if (!plans || !form) return;

    var input = form.querySelector('input[name="selling_plan"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "selling_plan";
      form.appendChild(input);
    }
    var select = plans.querySelector("[data-bb-plan-select]");
    var frequency = plans.querySelector("[data-bb-frequency]");
    var discountEl = plans.querySelector("[data-bb-plan-discount]");
    var subPriceEl = plans.querySelector("[data-bb-plan-sub-price]");
    var notePriceEl = plans.querySelector("[data-bb-plan-note-price]");
    var oneTimePriceEl = plans.querySelector("[data-bb-plan-onetime-price]");
    var oneTimeChoice = plans.querySelector('[data-bb-plan-choice][value="one-time"]');
    var subscribeChoice = plans.querySelector('[data-bb-plan-choice][value="subscribe"]');
    var planPrices = {};
    try {
      var pricesEl = plans.querySelector("[data-bb-plan-prices]");
      planPrices = JSON.parse(pricesEl ? pricesEl.textContent : "{}");
    } catch (e) {
      planPrices = {};
    }

    function variantId() {
      var idInput = form.querySelector('[name="id"]');
      return idInput ? String(idInput.value) : null;
    }

    function sync() {
      var vid = variantId();
      var variantPlans = (vid && planPrices[vid]) || {};
      // A variant without selling plans can only be bought once.
      var canSubscribe = Object.keys(variantPlans).length > 0;
      if (subscribeChoice) subscribeChoice.disabled = !canSubscribe && Boolean(oneTimeChoice);
      if (!canSubscribe && oneTimeChoice) oneTimeChoice.checked = true;

      var subscribing = Boolean(subscribeChoice && subscribeChoice.checked);
      if (frequency) frequency.hidden = !subscribing;
      if (select) {
        Array.prototype.forEach.call(select.options, function (option) {
          option.disabled = canSubscribe && variantPlans[option.value] === undefined;
        });
        if (select.selectedOptions[0] && select.selectedOptions[0].disabled) {
          var firstEnabled = Array.prototype.find.call(select.options, function (o) {
            return !o.disabled;
          });
          if (firstEnabled) select.value = firstEnabled.value;
        }
      }
      input.value = subscribing && select ? select.value : "";
      // Not sent at all for one-time purchases (rather than an empty value).
      input.disabled = !input.value;

      var option = select && select.selectedOptions[0];
      if (discountEl && option) discountEl.textContent = option.dataset.discount || "";
      if (select && variantPlans[select.value] !== undefined) {
        var planPrice = formatMoney(variantPlans[select.value]);
        if (subPriceEl) subPriceEl.textContent = planPrice;
        if (notePriceEl) notePriceEl.textContent = planPrice;
      }
      if (oneTimePriceEl && vid && prices[vid] !== undefined) {
        oneTimePriceEl.textContent = formatMoney(prices[vid]);
      }
      widget.dataset.bbPurchaseMode = subscribing ? "subscription" : "one_time";
      if (vid) refreshOffers(vid);
      plans.querySelectorAll(".bb-purchase__option").forEach(function (label) {
        var radio = label.querySelector("[data-bb-plan-choice]");
        label.classList.toggle("bb-purchase__option--active", Boolean(radio && radio.checked));
      });
    }

    plans.addEventListener("change", sync);
    form.addEventListener("change", sync);
    sync();
  }

  function initAll() {
    document.querySelectorAll("[data-bb-breaks]").forEach(init);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
  document.addEventListener("shopify:section:load", initAll);
})();

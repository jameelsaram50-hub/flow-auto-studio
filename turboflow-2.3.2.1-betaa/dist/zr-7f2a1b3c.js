!function(){
  "use strict";

  function flowLog(msg, data) {
    console.log('[TurboFlow Flow Hook]', msg, data || '');
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({
          type: "FLOW_LOG",
          msg: `[Flow Page] ${msg}`,
          data
        }).catch(() => {});
      }
    } catch(e) {}
  }

  flowLog('zr-7f2a1b3c.js injected and running on Google Flow page');

  // Notify background that Google Flow loaded & request sidepanel companion window
  function requestPanel() {
    try {
      if (chrome.runtime?.id) {
        chrome.runtime.sendMessage({ type: "FLOW_PAGE_LOADED", url: window.location.href }).catch(() => {});
        chrome.runtime.sendMessage({ type: "OPEN_SIDEPANEL_WINDOW" }).catch(() => {});
      }
    } catch (e) {}
  }
  requestPanel();
  const panelInterval = setInterval(requestPanel, 2000);
  setTimeout(() => clearInterval(panelInterval), 20000);

  // Robust click dispatcher for Angular Material components
  function triggerAngularClick(target) {
    if (!target) return;
    const btn = target.closest('button, [role="button"], a') || target;
    flowLog('Triggering Angular Material click on:', btn.outerHTML ? btn.outerHTML.substring(0, 150) : btn.tagName);

    try {
      btn.focus();
    } catch (e) {}

    const eventTypes = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
    eventTypes.forEach(type => {
      try {
        const evt = (type.startsWith('pointer'))
          ? new PointerEvent(type, { bubbles: true, cancelable: true, view: window })
          : new MouseEvent(type, { bubbles: true, cancelable: true, view: window });
        btn.dispatchEvent(evt);
        if (target !== btn) target.dispatchEvent(evt);
      } catch (e) {}
    });

    if (typeof btn.click === 'function') {
      btn.click();
    }
    if (target !== btn && typeof target.click === 'function') {
      target.click();
    }
  }

  // Auto-detect and enter or create project on Google Flow landing page
  function tryAutoEnterProject() {
    const href = window.location.href;
    if (href.includes('/project/')) return true;

    // 1. Direct search for Angular Material .mat-focus-indicator elements
    const matIndicators = document.querySelectorAll('.mat-focus-indicator, [class*="mat-focus-indicator"]');
    for (const ind of matIndicators) {
      const host = ind.closest('button, a, div[role="button"], [role="button"]') || ind.parentElement || ind;
      const txt = (host.innerText || host.textContent || '').trim().toLowerCase();
      if (txt.includes('new project') || txt.includes('create project') || txt.includes('project')) {
        flowLog('Found Angular Material button via mat-focus-indicator:', host.tagName);
        triggerAngularClick(host);
        return false;
      }
    }

    // 2. Check direct buttons or links
    const clickables = Array.from(document.querySelectorAll('button, a, div[role="button"], span[role="button"], [role="button"], [tabindex="0"]'));
    let newBtn = clickables.find(el => {
      const txt = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      return (
        txt === 'new project' ||
        txt.includes('new project') ||
        txt === 'create project' ||
        txt.includes('create project') ||
        txt.includes('blank canvas') ||
        txt.includes('blank project') ||
        txt.includes('start from scratch')
      );
    });

    // 3. Fallback: Search text nodes
    if (!newBtn) {
      const allElements = Array.from(document.querySelectorAll('*'));
      for (const el of allElements) {
        if (el.children.length === 0) {
          const txt = (el.textContent || '').trim().toLowerCase();
          if (txt.includes('new project') || txt === 'new project') {
            newBtn = el.closest('button, a, [role="button"], div, span') || el;
            break;
          }
        }
      }
    }

    if (newBtn) {
      flowLog('Found New Project button, clicking...');
      triggerAngularClick(newBtn);
      return false;
    }

    const projectLink = document.querySelector('a[href*="/project/"]');
    if (projectLink) {
      flowLog('Auto-opening project link: ' + projectLink.href);
      triggerAngularClick(projectLink);
      return false;
    }

    return false;
  }

  let projectAttempts = 0;
  const projectTimer = setInterval(() => {
    projectAttempts++;
    if (window.location.href.includes('/project/') || projectAttempts > 80) {
      clearInterval(projectTimer);
      return;
    }
    tryAutoEnterProject();
  }, 800);

  // Relay intercepted Flow APIs to extension background for auto-download
  window.addEventListener("message", function(t) {
    if (t.source === window && t.data?.type === "FLOW_AUTO_INTERCEPT" && chrome.runtime?.id) {
      chrome.runtime.sendMessage({
        type: "API_INTERCEPTED",
        eventType: t.data.eventType,
        url: t.data.url,
        method: t.data.method,
        status: t.data.status,
        data: t.data.data,
        timestamp: t.data.timestamp
      }).catch(() => {});
    }
  });

  // Extension runtime message handler
  chrome.runtime.onMessage.addListener((t, e, a) => {
    if ("GET_PAGE_STATE" === t.type) {
      const el = document.querySelector('div.ProseMirror, div[data-slate-editor="true"]');
      return a({ hasEditor: !!el, currentPrompt: el?.textContent || "", url: window.location.href }), !0;
    }
    if ("GET_ALL_IMAGES" === t.type) {
      const imgs = document.querySelectorAll('img[alt="Generated image"], img');
      return a({
        images: Array.from(imgs).map(img => ({ src: img.src }))
      }), !0;
    }
  });
}();
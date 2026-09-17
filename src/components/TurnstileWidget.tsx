import React, { useEffect, useRef } from 'react';

// The Cloudflare script (loaded via a <script> tag in index.html) attaches
// this global once it's ready — no npm package needed for Turnstile.
declare global {
  interface Window {
    turnstile?: {
      render: (container: string | HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

// Falls back to Cloudflare's own published "always passes" test site key
// when no real key is configured, so the widget still renders (and the form
// still works) in local/dev setups that haven't set up a real Turnstile site
// yet — set VITE_TURNSTILE_SITE_KEY to the real key from the Cloudflare
// dashboard before relying on this for actual bot protection.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

interface TurnstileWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}

export interface TurnstileWidgetHandle {
  reset: () => void;
}

export const TurnstileWidget = React.forwardRef<TurnstileWidgetHandle, TurnstileWidgetProps>(
  ({ onVerify, onExpire }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | undefined>(undefined);

    useEffect(() => {
      let cancelled = false;
      let pollInterval: ReturnType<typeof setInterval> | undefined;

      const renderWidget = () => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: SITE_KEY,
          theme: 'auto',
          callback: onVerify,
          'expired-callback': () => onExpire?.(),
        });
      };

      if (window.turnstile) {
        renderWidget();
      } else {
        // index.html's Turnstile <script> loads async — it may not have
        // finished executing yet by the time this component mounts, so poll
        // briefly instead of assuming a fixed load order.
        pollInterval = setInterval(() => {
          if (window.turnstile) {
            clearInterval(pollInterval);
            renderWidget();
          }
        }, 100);
      }

      return () => {
        cancelled = true;
        if (pollInterval) clearInterval(pollInterval);
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    React.useImperativeHandle(ref, () => ({
      reset: () => {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      },
    }));

    return <div ref={containerRef} />;
  }
);

TurnstileWidget.displayName = 'TurnstileWidget';

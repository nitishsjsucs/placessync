// Staff event stream (SPEC 7.2): subscribe_staff on every (re)connect and hand each
// staff_event to the page.
import { useEffect, useRef, useState } from "react";
import { ServerMessage, type StaffEventMessage } from "../../shared/live-protocol.ts";
import { type LiveStatus, LiveSocket, liveUrl } from "./socket.ts";

export function useStaffEvents(siteId: string | null, onEvent: (e: StaffEventMessage) => void, options: { WebSocketImpl?: typeof WebSocket; url?: string } = {}) {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const optionsRef = useRef(options);

  useEffect(() => {
    if (!siteId) return;
    const s = new LiveSocket({
      url: optionsRef.current.url ?? liveUrl(siteId),
      WebSocketImpl: optionsRef.current.WebSocketImpl,
      onStatus: setStatus,
      onOpen: () => s.send({ type: "subscribe_staff" }),
      onMessage: (raw) => {
        const parsed = ServerMessage.safeParse(raw);
        if (parsed.success && parsed.data.type === "staff_event") handler.current(parsed.data);
      },
    });
    return () => s.close();
  }, [siteId]);

  return status;
}

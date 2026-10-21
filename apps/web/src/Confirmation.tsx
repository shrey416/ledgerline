import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

type Request = { message: string; resolve: (accepted: boolean) => void };
function Confirmation({
  request,
  finish,
}: {
  request: Request;
  finish: (accepted: boolean) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      dialog.close();
      prior?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="entry-dialog confirmation-dialog"
      aria-labelledby="confirmation-title"
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
    >
      <div className="dialog-header">
        <h2 id="confirmation-title">
          <AlertTriangle size={18} />
          Confirm this change
        </h2>
      </div>
      <div className="form-body">
        <p>{request.message}</p>
      </div>
      <div className="dialog-footer">
        <button className="button" onClick={() => finish(false)}>
          Keep it
        </button>
        <button className="button primary" onClick={() => finish(true)}>
          Confirm change
        </button>
      </div>
    </dialog>
  );
}
export function useConfirmation() {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<Request | null>(null);
  useEffect(
    () => () => {
      pending.current?.resolve(false);
    },
    [],
  );
  function ask(message: string) {
    pending.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { message, resolve };
      pending.current = next;
      setRequest(next);
    });
  }
  function finish(accepted: boolean) {
    pending.current?.resolve(accepted);
    pending.current = null;
    setRequest(null);
  }
  return [ask, request ? <Confirmation request={request} finish={finish} /> : null] as const;
}

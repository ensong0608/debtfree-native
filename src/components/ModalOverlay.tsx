import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, type ModalProps } from 'react-native';
import { View } from './NativeAppearance';

type OverlayEntry = {
  id: string;
  node: ReactNode;
  onRequestClose?: () => void;
};

type OverlayStore = {
  setOverlay: (id: string, node: ReactNode | null, onRequestClose?: () => void) => void;
  getOverlays: () => readonly OverlayEntry[];
  subscribe: (listener: () => void) => () => void;
  handleTopClose: () => boolean;
};

function createOverlayStore(): OverlayStore {
  let entries: OverlayEntry[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    listeners.forEach(listener => listener());
  };
  return {
    setOverlay(id, node, onRequestClose) {
      const idx = entries.findIndex(entry => entry.id === id);
      if (node === null) {
        if (idx === -1) return;
        entries = entries.filter(entry => entry.id !== id);
        notify();
        return;
      }
      if (idx >= 0) {
        entries = entries.map((entry, i) => (i === idx ? { id, node, onRequestClose } : entry));
      } else {
        entries = [...entries, { id, node, onRequestClose }];
      }
      notify();
    },
    getOverlays() {
      return entries;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    handleTopClose() {
      const top = entries[entries.length - 1];
      if (!top) return false;
      top.onRequestClose?.();
      return true;
    },
  };
}

const ModalOverlayContext = createContext<OverlayStore | null>(null);

function OverlayOutlet({ store }: { store: OverlayStore }) {
  const [, setVersion] = useState(0);
  useEffect(() => store.subscribe(() => setVersion(v => v + 1)), [store]);
  const overlays = store.getOverlays();
  if (overlays.length === 0) return null;
  return (
    <>
      {overlays.map(entry => (
        <View
          key={entry.id}
          accessibilityViewIsModal
          style={[StyleSheet.absoluteFill, { zIndex: 100 }]}
          pointerEvents="box-none"
        >
          {entry.node}
        </View>
      ))}
    </>
  );
}

/**
 * Renders a native `<Modal>` at the top level and portals any nested `AdaptiveModal`
 * children into an in-modal overlay layer so two RN `<Modal>`s never stack simultaneously.
 */
export function AdaptiveModal({
  visible,
  transparent = true,
  animationType = 'fade',
  presentationStyle,
  onRequestClose,
  children,
}: {
  visible: boolean;
  transparent?: boolean;
  animationType?: ModalProps['animationType'];
  presentationStyle?: ModalProps['presentationStyle'];
  onRequestClose?: () => void;
  children: ReactNode;
}) {
  const parentStore = useContext(ModalOverlayContext);
  const overlayId = useId();
  const [localStore] = useState<OverlayStore | null>(() => (parentStore ? null : createOverlayStore()));

  const onRequestCloseRef = useRef(onRequestClose);
  useEffect(() => {
    onRequestCloseRef.current = onRequestClose;
  }, [onRequestClose]);
  const stableClose = useCallback(() => {
    onRequestCloseRef.current?.();
  }, []);

  useEffect(() => {
    if (!parentStore) return;
    if (visible) {
      parentStore.setOverlay(overlayId, children, stableClose);
    } else {
      parentStore.setOverlay(overlayId, null);
    }
  }, [parentStore, overlayId, visible, children, stableClose]);

  useEffect(() => {
    if (!parentStore) return;
    return () => {
      parentStore.setOverlay(overlayId, null);
    };
  }, [parentStore, overlayId]);

  if (parentStore) {
    return null;
  }

  const store = localStore!;
  return (
    <Modal
      visible={visible}
      transparent={transparent}
      statusBarTranslucent
      navigationBarTranslucent
      animationType={animationType}
      presentationStyle={presentationStyle}
      onRequestClose={() => {
        if (!store.handleTopClose()) {
          onRequestClose?.();
        }
      }}
    >
      <ModalOverlayContext.Provider value={store}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {children}
            <OverlayOutlet store={store} />
          </View>
        </KeyboardAvoidingView>
      </ModalOverlayContext.Provider>
    </Modal>
  );
}

function useLibraryPins(kind, onError) {
  const [pins, setPins] = React.useState([]);
  const [saving, setSaving] = React.useState(false);
  const running = React.useRef(false);
  React.useEffect(function () {
    let active = true;
    function refresh() {
      rpc('getLibraryPins', {}).then(state => { if (active) setPins(state[kind] || []); }, error => { if (active) onError(String(error.message || error)); });
    }
    refresh();
    window.addEventListener('dsh-tavern-library-pins-changed', refresh);
    window.addEventListener('dsh-tavern-data-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('dsh-tavern-library-pins-changed', refresh);
      window.removeEventListener('dsh-tavern-data-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [kind]);
  function button(path, disabled) {
    const pinned = pins.includes(path);
    return React.createElement('button', { type: 'button', className: 'dsh-tavern-btn', disabled: disabled || saving,
      'aria-pressed': pinned, onClick: async function (event) {
        event.stopPropagation();
        if (running.current) return;
        running.current = true; setSaving(true);
        try {
          const state = await rpc('setLibraryPin', { kind, path, pinned: !pinned });
          setPins(state[kind] || []);
          window.dispatchEvent(new Event('dsh-tavern-library-pins-changed'));
        } catch (error) { onError(String(error.message || error)); }
        finally { running.current = false; setSaving(false); }
      }
    }, pinned ? '取消置顶' : '置顶');
  }
  return { button, order: (items, pathOf = item => item.path) => items.slice().sort((a, b) => Number(pins.includes(pathOf(b))) - Number(pins.includes(pathOf(a)))) };
}

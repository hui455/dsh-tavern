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
  function button(path, disabled, options = {}) {
    const pinned = pins.includes(path);
    return React.createElement('button', { type: 'button', className: options.icon ? 'dsh-tavern-grid-pin' : 'dsh-tavern-btn', disabled: disabled || saving,
      title: pinned ? '取消置顶' : '置顶', 'aria-label': (pinned ? '取消置顶' : '置顶') + (options.name ? '：' + options.name : ''),
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
    }, options.icon ? React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', 'aria-hidden': true,
      fill: pinned ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' },
      React.createElement('path', { d: 'M8 3h8l-1 7 4 4v2H5v-2l4-4-1-7Z' }),
      React.createElement('path', { d: 'M12 16v6' })) : pinned ? '取消置顶' : '置顶');
  }
  return { button, order: (items, pathOf = item => item.path) => items.slice().sort((a, b) => Number(pins.includes(pathOf(b))) - Number(pins.includes(pathOf(a)))) };
}

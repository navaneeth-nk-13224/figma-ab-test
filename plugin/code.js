// AB Test Figma Plugin — Main Code (runs in Figma sandbox)

figma.showUI(__html__, { width: 400, height: 540 });

// Notify UI of current selection on launch
notifySelection();

// Listen for selection changes
figma.on('selectionchange', () => {
  notifySelection();
});

function notifySelection() {
  const selection = figma.currentPage.selection;
  if (selection.length === 2) {
    figma.ui.postMessage({
      type: 'selection-valid',
      frames: [
        { name: selection[0].name, id: selection[0].id },
        { name: selection[1].name, id: selection[1].id }
      ]
    });
  } else {
    figma.ui.postMessage({
      type: 'selection-invalid',
      count: selection.length
    });
  }
}

figma.ui.onmessage = async (msg) => {

  if (msg.type === 'export-frames') {
    const selection = figma.currentPage.selection;
    if (selection.length !== 2) {
      figma.ui.postMessage({ type: 'error', message: 'Please select exactly 2 frames.' });
      return;
    }

    try {
      const settings = { format: 'PNG', constraint: { type: 'SCALE', value: 1 } };
      const imageA = await selection[0].exportAsync(settings);
      const imageB = await selection[1].exportAsync(settings);

      figma.ui.postMessage({
        type: 'frames-exported',
        imageA: Array.from(imageA),
        imageB: Array.from(imageB),
        nameA: selection[0].name,
        nameB: selection[1].name
      });
    } catch (err) {
      figma.ui.postMessage({ type: 'error', message: 'Export failed: ' + err.message });
    }
  }

  if (msg.type === 'save-test') {
    const tests = (await figma.clientStorage.getAsync('ab-tests')) || [];
    tests.unshift(msg.test);
    await figma.clientStorage.setAsync('ab-tests', tests);
    figma.ui.postMessage({ type: 'test-saved' });
  }

  if (msg.type === 'load-tests') {
    const tests = (await figma.clientStorage.getAsync('ab-tests')) || [];
    figma.ui.postMessage({ type: 'tests-loaded', tests });
  }

  if (msg.type === 'delete-test') {
    let tests = (await figma.clientStorage.getAsync('ab-tests')) || [];
    tests = tests.filter(t => t.id !== msg.testId);
    await figma.clientStorage.setAsync('ab-tests', tests);
    figma.ui.postMessage({ type: 'tests-loaded', tests });
  }

  if (msg.type === 'close') {
    figma.closePlugin();
  }
};

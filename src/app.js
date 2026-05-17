import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';

import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';

import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';

import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';

export function render({ model, el }) {

  // ----------------------------------------------------------------------------
  // Renderer setup
  // ----------------------------------------------------------------------------

  const genericRenderWindow = vtkGenericRenderWindow.newInstance();

  genericRenderWindow.setContainer(el);

  el.style.width = '100%';
  el.style.height = '100%';
  el.style.overflow = 'hidden';
  el.style.position = 'relative';

  genericRenderWindow.resize();

  const renderer = genericRenderWindow.getRenderer();
  const renderWindow = genericRenderWindow.getRenderWindow();

  renderer.setBackground(1, 1, 1);

  // renderer.setUseDepthPeeling(true);
  // renderer.setMaximumNumberOfPeels(100);
  // renderer.setOcclusionRatio(0.1);

  // ----------------------------------------------------------------------------
  // Tooltip
  // ----------------------------------------------------------------------------

  const tooltip = document.createElement('div');

  tooltip.style.position = 'absolute';
  tooltip.style.pointerEvents = 'none';
  tooltip.style.background = 'rgba(0,0,0,0.8)';
  tooltip.style.color = 'white';
  tooltip.style.padding = '6px 8px';
  tooltip.style.fontSize = '12px';
  tooltip.style.fontFamily = 'monospace';
  tooltip.style.borderRadius = '4px';
  tooltip.style.whiteSpace = 'nowrap';
  tooltip.style.display = 'none';
  tooltip.style.zIndex = '100';

  el.appendChild(tooltip);

  // ----------------------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------------------

  function toTyped(buffer, dtype) {

    if (!buffer) return null;

    switch (dtype) {

      case 'uint8':
        return new Uint8Array(buffer);

      case 'float32':
      default:
        return new Float32Array(buffer);
    }
  }

  function makeCellArray(cell) {

    if (!cell || !cell.buffer) return null;

    const values = new Uint32Array(cell.buffer);

    const vtkArr = vtkCellArray.newInstance();

    vtkArr.setData(values);

    return vtkArr;
  }

  // ----------------------------------------------------------------------------
  // Persistent pipeline
  // ----------------------------------------------------------------------------

  const polyData = vtkPolyData.newInstance();

  const mapper = vtkMapper.newInstance();

  mapper.setInputData(polyData);

  mapper.setScalarVisibility(true);

  mapper.setScalarModeToUseCellFieldData();

  mapper.setColorModeToDirectScalars();

  mapper.setColorByArrayName('rgb');

  const actor = vtkActor.newInstance();

  actor.setMapper(mapper);

  // actor.setForceTranslucent(true);

  const prop = actor.getProperty();

  prop.setRepresentationToSurface();

  prop.setEdgeVisibility(true);

  prop.setEdgeColor(0, 0, 0);

  prop.setAmbient(0.2);
  prop.setDiffuse(0.8);
  prop.setSpecular(0.1);

  prop.setOpacity(1.0);

  renderer.addActor(actor);

  // ----------------------------------------------------------------------------
  // Picker
  // ----------------------------------------------------------------------------

  const picker = vtkCellPicker.newInstance();

  picker.setPickFromList(true);

  picker.initializePickList();

  picker.addPickList(actor);

  // ----------------------------------------------------------------------------
  // Update PolyData
  // ----------------------------------------------------------------------------

  function updatePolyData(data) {

    if (!data) return;

    // --------------------------------------------------------------------------
    // POINTS
    // --------------------------------------------------------------------------

    const pts = toTyped(
      data.points?.buffer,
      data.points?.dtype || 'float32'
    );

    if (pts) {

      const points = vtkPoints.newInstance();

      points.setData(pts, 3);

      polyData.setPoints(points);
    }

    // --------------------------------------------------------------------------
    // TOPOLOGY
    // --------------------------------------------------------------------------

    const polys = makeCellArray(data.polys);
    const lines = makeCellArray(data.lines);
    const verts = makeCellArray(data.verts);
    const strips = makeCellArray(data.strips);

    polyData.setPolys(polys || null);
    polyData.setLines(lines || null);
    polyData.setVerts(verts || null);
    polyData.setStrips(strips || null);

    // --------------------------------------------------------------------------
    // CLEAR OLD DATA
    // --------------------------------------------------------------------------

    polyData.getPointData().initialize();
    polyData.getCellData().initialize();

    // --------------------------------------------------------------------------
    // POINT DATA
    // --------------------------------------------------------------------------

    const pointData = data.pointData || {};

    Object.entries(pointData).forEach(([name, entry], idx) => {

      const arr = toTyped(
        entry.buffer,
        entry.dtype
      );

      if (!arr) return;

      const vtkArr = vtkDataArray.newInstance({
        name,
        values: arr,
        numberOfComponents: entry.components || 1,
      });

      polyData.getPointData().addArray(vtkArr);

      if (idx === 0) {
        polyData.getPointData().setScalars(vtkArr);
      }
    });

    // --------------------------------------------------------------------------
    // CELL DATA
    // --------------------------------------------------------------------------

    const cellData = data.cellData || {};

    Object.entries(cellData).forEach(([name, entry]) => {

      const arr = toTyped(
        entry.buffer,
        entry.dtype
      );

      if (!arr) return;

      const vtkArr = vtkDataArray.newInstance({
        name,
        values: arr,
        numberOfComponents: entry.components || 1,
      });

      polyData.getCellData().addArray(vtkArr);
    });

    polyData.modified();

    mapper.modified();

    renderer.resetCameraClippingRange();

    renderWindow.render();
  }

  // ----------------------------------------------------------------------------
  // Initial load
  // ----------------------------------------------------------------------------

  updatePolyData(model.vtp_data);

  renderer.resetCamera();

  renderWindow.render();

  // ----------------------------------------------------------------------------
  // Hover picking
  // ----------------------------------------------------------------------------
  let hoverEnabled = !!model.info;

  function onMouseMove(e) {

    if (!hoverEnabled) return;

    const rect = el.getBoundingClientRect();

    // --------------------------------------------------------------------------
    // DOM coordinates
    // --------------------------------------------------------------------------

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // --------------------------------------------------------------------------
    // vtk/OpenGL coordinates
    // --------------------------------------------------------------------------

    const vtkY = rect.height - y;

    picker.pick(
      [x, vtkY, 0],
      renderer
    );

    const pickedCellId = picker.getCellId();

    if (pickedCellId < 0) {

      tooltip.style.display = 'none';

      return;
    }

    // --------------------------------------------------------------------------
    // World coordinates
    // --------------------------------------------------------------------------

    const world = picker.getPickPosition();

    // --------------------------------------------------------------------------
    // Cell data
    // --------------------------------------------------------------------------

    const cellData = polyData.getCellData();

    const cellIdArray =
      cellData.getArrayByName('cell_id');

    const rgbaArray =
      cellData.getArrayByName('rgba');

    const cellValue =
      cellIdArray
        ? cellIdArray.getValue(pickedCellId)
        : 'N/A';

    const rgba =
      rgbaArray
        ? rgbaArray.getTuple(pickedCellId)
        : null;

    // --------------------------------------------------------------------------
    // Tooltip
    // --------------------------------------------------------------------------

    tooltip.innerHTML = `
      <div><b>cell_id</b>: ${pickedCellId}</div>
      <div><b>cell_value</b>: ${cellValue}</div>
      <div>
        <b>xyz</b>:
        ${world.map(v => v.toFixed(4)).join(', ')}
      </div>
      ${
        rgba
          ? `
            <div>
              <b>rgba</b>:
              ${rgba.map(v => Math.round(v)).join(', ')}
            </div>
          `
          : ''
      }
    `;

    tooltip.style.left = `${x + 12}px`;
    tooltip.style.top = `${y + 12}px`;

    tooltip.style.display = 'block';
  }

  function onMouseLeave() {
    tooltip.style.display = 'none';
  }

  function enableHover(enable) {

    hoverEnabled = enable;

    tooltip.style.display = 'none';
  }

  el.addEventListener('mousemove', onMouseMove);

  el.addEventListener('mouseleave', onMouseLeave);

  // ----------------------------------------------------------------------------
  // Watch model updates
  // ----------------------------------------------------------------------------

  const onModelChange = () => {

    updatePolyData(model.vtp_data);

    const next = !!model.info;

    if (next !== hoverEnabled) {
      enableHover(next);
    }
  };

  model.on?.('change:vtp_data', onModelChange);
  model.on?.('change:info', onModelChange);

  // ----------------------------------------------------------------------------
  // Resize handling
  // ----------------------------------------------------------------------------

  const resizeObserver = new ResizeObserver(() => {

    genericRenderWindow.resize();

    renderWindow.render();
  });

  resizeObserver.observe(el);

  // ----------------------------------------------------------------------------
  // Cleanup
  // ----------------------------------------------------------------------------

  return () => {

    resizeObserver.disconnect();

    el.removeEventListener('mousemove', onMouseMove);

    el.removeEventListener('mouseleave', onMouseLeave);

    model.off?.('change:vtp_data', onModelChange);
    model.off?.('change:info', onModelChange);

    tooltip.remove();

    genericRenderWindow.delete();
  };
}
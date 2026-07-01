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
  function updateGeometry(data) {
    if (!data) return;

    // Points
    const pts = toTyped(
      data.points?.buffer,
      data.points?.dtype || "float32"
    );

    if (pts) {
      const points = vtkPoints.newInstance();
      points.setData(pts, 3);
      polyData.setPoints(points);
    }

    // Topology
    polyData.setPolys(makeCellArray(data.polys));
    polyData.setLines(makeCellArray(data.lines));
    polyData.setVerts(makeCellArray(data.verts));
    polyData.setStrips(makeCellArray(data.strips));

    polyData.modified();
  }

  function updateScalars(data) {
    if (!data) return;

    // ------------------------------------------------------------------
    // Point data
    // ------------------------------------------------------------------

    const pd = polyData.getPointData();
    pd.initialize();

    Object.entries(data.pointData || {}).forEach(([name, entry], idx) => {

      const vtkArr = vtkDataArray.newInstance({
        name,
        values: toTyped(entry.buffer, entry.dtype),
        numberOfComponents: entry.components,
      });

      pd.addArray(vtkArr);

      if (idx === 0) {
        pd.setScalars(vtkArr);
      }
    });

    // ------------------------------------------------------------------
    // Cell data
    // ------------------------------------------------------------------

    const cd = polyData.getCellData();
    cd.initialize();

    Object.entries(data.cellData || {}).forEach(([name, entry]) => {

      const vtkArr = vtkDataArray.newInstance({
        name,
        values: toTyped(entry.buffer, entry.dtype),
        numberOfComponents: entry.components,
      });

      cd.addArray(vtkArr);
    });

    pd.modified();
    cd.modified();
    polyData.modified();
  }

  function renderUpdate(resetCamera = false) {
    mapper.modified();

    if (resetCamera) {
      renderer.resetCamera();
    } else {
      renderer.resetCameraClippingRange();
    }

    renderWindow.render();
  }
  // ----------------------------------------------------------------------------
  // Initial load
  // ----------------------------------------------------------------------------
  updateGeometry(model.geometry);
  updateScalars(model.colors);
  renderUpdate(true);

  // ----------------------------------------------------------------------------
  // Hover picking
  // ----------------------------------------------------------------------------
  let hoverEnabled = !!model.info;
  let lastHover = {
    cellId: -2,
    cellValue: null,
    position: [NaN, NaN, NaN],
  };
  function updateHover(cellId, cellValue, world) {

    const x = world?.[0] ?? NaN;
    const y = world?.[1] ?? NaN;
    const z = world?.[2] ?? NaN;

    if (
      lastHover.cellId === cellId &&
      lastHover.cellValue === cellValue &&
      lastHover.position[0] === x &&
      lastHover.position[1] === y &&
      lastHover.position[2] === z
    ) {
      return;
    }

    lastHover = {
      cellId,
      cellValue,
      position: [x, y, z]
    };

    model.hover_cell_id = cellId;
    model.hover_cell_value = cellValue ?? -1;
    model.hover_position = [x, y, z];
  }
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
      updateHover(-1, -1, null);


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

    updateHover(
      pickedCellId,
      cellValue,
      world
    );

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
      ${rgba
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
    updateHover(-1, -1, null);
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

  const onInfoChange = () => {
    const next = !!model.info;

    if (next !== hoverEnabled) {
      enableHover(next);
    }
  };
  model.on("change:geometry", () => {
    updateGeometry(model.geometry);
    renderUpdate(true);
  });

  model.on("change:colors", () => {
    updateScalars(model.colors);
    renderUpdate(false);
  });

  model.on?.('change:info', onInfoChange);

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

    model.off?.('change:geometry', updateGeometry);
    model.off?.('change:colors', updateScalars);
    model.off?.('change:info', onInfoChange);

    tooltip.remove();

    genericRenderWindow.delete();
  };
}
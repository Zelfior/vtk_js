import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';

import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';

import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';

import vtkCellPicker from '@kitware/vtk.js/Rendering/Core/CellPicker';

import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkClipPolyData from '@kitware/vtk.js/Filters/Core/ClipPolyData';
import vtkImplicitPlaneWidget from '@kitware/vtk.js/Widgets/Widgets3D/ImplicitPlaneWidget';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';

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
  // The real OpenGL render window - used to translate CSS mouse coordinates
  // into the framebuffer's actual pixel space (see onMouseMove / picking
  // fix below). Its size can differ from el.getBoundingClientRect() by
  // window.devicePixelRatio on hi-DPI displays.
  const openGLRenderWindow = genericRenderWindow.getApiSpecificRenderWindow();

  renderer.setBackground(1, 1, 1);

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
  // Clip Plane and Widget
  //
  // ONE implicit vtkPlane drives ONE vtkClipPolyData filter. Previously there
  // was a second, unused "clipPlane" object that was actually a vtkClipPolyData
  // instance being mistakenly treated as the plane (setOrigin/setNormal calls
  // on a filter, and used as the clip *function* of the real clipper). That's
  // why clipping never worked.
  // ----------------------------------------------------------------------------

  const plane = vtkPlane.newInstance();
  plane.setNormal(0, 0, 1);
  plane.setOrigin(0, 0, 0);

  // Create the implicit plane widget for interaction
  const widget = vtkImplicitPlaneWidget.newInstance();
  widget.setPlaceFactor(1.25);

  const widgetState = widget.getWidgetState();

  function syncWidgetFromPlane() {
    widgetState.setOrigin(clipOrigin);
    widgetState.setNormal(clipNormal);
  }

  // Widget manager to handle the widget
  const widgetManager = vtkWidgetManager.newInstance();
  widgetManager.setRenderer(renderer);
  const widgetInstance = widgetManager.addWidget(widget);
  widgetManager.enablePicking();

  let planeEnabled = model.plane_visible !== undefined ? model.plane_visible : true;

  function setPlaneWidgetVisible(enabled) {
    planeEnabled = enabled;
    widgetInstance.setVisibility(enabled);
    renderWindow.render();
  }
  setPlaneWidgetVisible(planeEnabled);

  // Initialize widget with the geometry bounds after data is loaded
  function initializeWidget() {
    const bounds = polyData.getBounds();
    // Check if bounds are valid (non-zero size)
    const size = [
      bounds[1] - bounds[0],
      bounds[3] - bounds[2],
      bounds[5] - bounds[4],
    ];
    if (size[0] > 0 || size[1] > 0 || size[2] > 0) {
      widget.placeWidget(bounds);
    }
  }

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

  // ----------------------------------------------------------------------------
  // Main Actor Setup (original, unclipped geometry)
  // ----------------------------------------------------------------------------

  const mapper = vtkMapper.newInstance();
  mapper.setInputData(polyData);

  mapper.setScalarVisibility(true);
  mapper.setScalarModeToUseCellFieldData();
  mapper.setColorModeToDirectScalars();
  mapper.setColorByArrayName('rgb');

  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);

  const prop = actor.getProperty();
  prop.setRepresentationToSurface();
  // Edges are no longer drawn by VTK's flat-color edge rendering - see the
  // "Feature Edges" section below, which draws a colored, cell_id-aware
  // edge overlay instead.
  prop.setEdgeVisibility(false);
  prop.setAmbient(0.2);
  prop.setDiffuse(0.8);
  prop.setSpecular(0.1);
  prop.setOpacity(1.0);

  renderer.addActor(actor);

  // ----------------------------------------------------------------------------
  // Clipped Actor Setup
  //
  // `clipper` (vtkClipPolyData) is a fast, local, purely-geometric clip of
  // `polyData` - cheap enough to run on every mouse-move. It cuts away the
  // body correctly, but leaves an open hole at the cut (vtk.js doesn't know
  // the real field data through the interior, so it can't cap it properly).
  // ----------------------------------------------------------------------------

  const clipper = vtkClipPolyData.newInstance();
  clipper.setClipFunction(plane);
  clipper.setInputData(polyData);

  const clipMapper = vtkMapper.newInstance();
  clipMapper.setInputConnection(clipper.getOutputPort());
  clipMapper.setScalarVisibility(true);
  clipMapper.setScalarModeToUseCellFieldData();
  clipMapper.setColorModeToDirectScalars();
  clipMapper.setColorByArrayName('rgb');

  const clipActor = vtkActor.newInstance();
  clipActor.setMapper(clipMapper);

  const clipProp = clipActor.getProperty();
  clipProp.setRepresentationToSurface();
  clipProp.setEdgeVisibility(false);
  clipProp.setAmbient(0.2);
  clipProp.setDiffuse(0.8);
  clipProp.setSpecular(0.1);

  renderer.addActor(clipActor);

  // ----------------------------------------------------------------------------
  // Cap Actor Setup
  //
  // `capPolyData` holds the exact intersection between the clip plane and
  // the real source mesh, computed in python via pyvista's `.slice()` (see
  // `_recompute_clip_slice` in the python component) and delivered through
  // `model.clip_slice`. It's a thin, real cross-section with real
  // interpolated data - not a blind triangulated fill - and is rendered as
  // a separate actor sitting right in the hole left by `clipActor`.
  //
  // It only updates once python has computed a fresh slice (i.e. after the
  // mouse is released - see `onEndInteractionEvent` below), and is hidden
  // while the plane is actively being dragged since a stale cap would be
  // misleading.
  // ----------------------------------------------------------------------------

  const capPolyData = vtkPolyData.newInstance();

  const capMapper = vtkMapper.newInstance();
  capMapper.setInputData(capPolyData);
  capMapper.setScalarVisibility(true);
  capMapper.setScalarModeToUseCellFieldData();
  capMapper.setColorModeToDirectScalars();
  capMapper.setColorByArrayName('rgb');

  let hasCapSlice = false;

  const capActor = vtkActor.newInstance();
  capActor.setMapper(capMapper);

  const capProp = capActor.getProperty();
  capProp.setRepresentationToSurface();
  capProp.setEdgeVisibility(false);
  capProp.setAmbient(0.3);
  capProp.setDiffuse(0.7);
  capProp.setSpecular(0.0);
  // Slight forward offset so the cap doesn't z-fight with the clipped
  // body's cut edge.
  capProp.setLighting(true);

  capActor.setVisibility(false);
  renderer.addActor(capActor);

  // ----------------------------------------------------------------------------
  // Feature Edges
  //
  // VTK's built-in EdgeVisibility draws every triangle edge in one flat
  // color - visually flat, and noisy on triangulated meshes since every
  // triangulation edge shows, not just meaningful ones. Instead we build our
  // own thin line geometry per surface (main / clipped / cap) containing
  // only:
  //   - mesh boundary edges (used by exactly one triangle), and
  //   - edges shared by two triangles whose 'cell_id' differ.
  // Internal triangulation edges within the same cell_id are skipped
  // entirely. Each edge is colored from its adjacent face color(s),
  // darkened by a fixed amount, so edge color tracks face color instead of
  // being flat black.
  //
  // `cell_id` and `rgb` are both cell-indexed arrays, one entry per polygon
  // in the same order as the `polys` connectivity (see the python side's
  // `polydata_to_dict`), which is what makes matching edges to their owning
  // cell's data straightforward.
  // ----------------------------------------------------------------------------

  const EDGE_DARKEN_FRACTION = 0.5; // "color - 40%", i.e. multiply by 0.6

  function darkenRGB(tuple) {
    return tuple.map((v) => v * (1 - EDGE_DARKEN_FRACTION));
  }

  // Parse a vtk.js CellArray (legacy flat format: n, id0..idn-1, n, ...)
  // into an array of point-id arrays, one per cell.
  function parseCellsPointIds(cellArray) {
    if (!cellArray || cellArray.getNumberOfCells() === 0) return [];
    const data = cellArray.getData();
    const cells = [];
    let i = 0;
    while (i < data.length) {
      const n = data[i];
      const pts = new Array(n);
      for (let k = 0; k < n; k++) pts[k] = data[i + 1 + k];
      cells.push(pts);
      i += n + 1;
    }
    return cells;
  }

  /**
   * Build { points, lines, colors } describing the feature edges of
   * `sourcePolyData`'s polys. Returns null if there's nothing to draw (no
   * polys at all).
   */
  function buildFeatureEdges(sourcePolyData) {
    const polys = sourcePolyData?.getPolys();
    const points = sourcePolyData?.getPoints();
    if (!polys || polys.getNumberOfCells() === 0 || !points) return null;

    const cd = sourcePolyData.getCellData();
    const cellIdArray = cd.getArrayByName('cell_id');
    const rgbArray = cd.getArrayByName('rgb');

    // Cell data is indexed across verts+lines+polys+strips in that order,
    // so a poly at local index `k` sits at global cell id `cellOffset + k`.
    const cellOffset =
      sourcePolyData.getVerts().getNumberOfCells() +
      sourcePolyData.getLines().getNumberOfCells();

    const cellsPointIds = parseCellsPointIds(polys);

    // edgeKey "a_b" (a < b) -> owning poly-local cell indices
    const edgeOwners = new Map();
    cellsPointIds.forEach((pts, cellIdx) => {
      const n = pts.length;
      for (let k = 0; k < n; k++) {
        const a = pts[k];
        const b = pts[(k + 1) % n];
        const key = a < b ? `${a}_${b}` : `${b}_${a}`;
        let owners = edgeOwners.get(key);
        if (!owners) {
          owners = [];
          edgeOwners.set(key, owners);
        }
        owners.push(cellIdx);
      }
    });

    const linePairs = [];
    const lineColors = [];

    edgeOwners.forEach((owners, key) => {
      let colorTuple = null;

      if (owners.length === 1) {
        // Mesh boundary edge - always shown.
        const g = cellOffset + owners[0];
        colorTuple = rgbArray ? Array.from(rgbArray.getTuple(g)) : [0, 0, 0];
      } else {
        // Shared by 2+ triangles (2 for a manifold mesh; for non-manifold
        // meshes just compare the first two owners). Only show it if the
        // owning cells belong to different logical cell_id groups.
        const [c0, c1] = owners;
        const g0 = cellOffset + c0;
        const g1 = cellOffset + c1;
        const id0 = cellIdArray ? cellIdArray.getValue(g0) : g0;
        const id1 = cellIdArray ? cellIdArray.getValue(g1) : g1;
        if (id0 !== id1) {
          const rgb0 = rgbArray ? Array.from(rgbArray.getTuple(g0)) : [0, 0, 0];
          const rgb1 = rgbArray ? Array.from(rgbArray.getTuple(g1)) : [0, 0, 0];
          colorTuple = rgb0.map((v, i) => (v + rgb1[i]) / 2);
        }
      }

      if (colorTuple) {
        const [a, b] = key.split('_').map(Number);
        linePairs.push(a, b);
        const dark = darkenRGB(colorTuple);
        lineColors.push(dark[0]*255, dark[1]*255, dark[2]*255);
      }
    });

    if (linePairs.length === 0) return null;

    const numEdges = linePairs.length / 2;
    const linesFlat = new Uint32Array(numEdges * 3);
    for (let e = 0; e < numEdges; e++) {
      linesFlat[e * 3] = 2;
      linesFlat[e * 3 + 1] = linePairs[e * 2];
      linesFlat[e * 3 + 2] = linePairs[e * 2 + 1];
    }

    return {
      points: points.getData(), // reuse the source's own point buffer directly
      lines: linesFlat,
      colors: new Uint8Array(lineColors),
    };
  }

  function makeEdgeActor() {
    const edgePolyData = vtkPolyData.newInstance();
    const edgeMapper = vtkMapper.newInstance();
    edgeMapper.setInputData(edgePolyData);
    edgeMapper.setScalarVisibility(true);
    edgeMapper.setScalarModeToUseCellFieldData();
    edgeMapper.setColorModeToDirectScalars();
    edgeMapper.setColorByArrayName('rgb');

    const edgeActor = vtkActor.newInstance();
    edgeActor.setMapper(edgeMapper);
    edgeActor.getProperty().setLighting(false);
    edgeActor.getProperty().setLineWidth(1.5);
    edgeActor.setVisibility(false);
    renderer.addActor(edgeActor);

    return { edgePolyData, edgeActor };
  }

  const { edgePolyData: mainEdgePolyData, edgeActor: mainEdgeActor } = makeEdgeActor();
  const { edgePolyData: clipEdgePolyData, edgeActor: clipEdgeActor } = makeEdgeActor();
  const { edgePolyData: capEdgePolyData, edgeActor: capEdgeActor } = makeEdgeActor();

  let hasMainEdges = false;
  let hasClipEdges = false;
  let hasCapEdges = false;

  // Edge actors mirror the visibility of the surface they belong to (no
  // point showing clip edges while the clipped body itself is hidden).
  function syncEdgeVisibility() {
    mainEdgeActor.setVisibility(hasMainEdges && actor.getVisibility());
    clipEdgeActor.setVisibility(hasClipEdges && clipActor.getVisibility());
    capEdgeActor.setVisibility(hasCapEdges && capActor.getVisibility());
  }

  function loadEdgesInto(sourcePolyData, targetEdgePolyData) {
    const built = buildFeatureEdges(sourcePolyData);
    if (!built) return false;

    const pointsObj = vtkPoints.newInstance();
    pointsObj.setData(built.points, 3);
    targetEdgePolyData.setPoints(pointsObj);

    const linesArr = vtkCellArray.newInstance();
    linesArr.setData(built.lines);
    targetEdgePolyData.setLines(linesArr);

    const cellD = targetEdgePolyData.getCellData();
    cellD.initialize();
    const colorArr = vtkDataArray.newInstance({
      name: 'rgb',
      values: built.colors,
      numberOfComponents: 3,
    });
    cellD.addArray(colorArr);
    cellD.setScalars(colorArr);
    cellD.modified();

    targetEdgePolyData.modified();
    return true;
  }

  // Recomputing is O(triangle count) - cheap enough to call after any
  // "settled" change (load, color update, mouse-release on the clip
  // widget), but deliberately NOT wired into the continuous drag callback
  // (`onInteractionEvent`) to avoid re-parsing the whole clipped mesh on
  // every mouse-move frame. During an active drag the clip edges simply
  // stay as they were until the mouse is released.
  function refreshMainEdges() {
    hasMainEdges = loadEdgesInto(polyData, mainEdgePolyData);
    syncEdgeVisibility();
  }
  function refreshClipEdges() {
    hasClipEdges = loadEdgesInto(clipper.getOutputData(), clipEdgePolyData);
    syncEdgeVisibility();
  }
  function refreshCapEdges() {
    hasCapEdges = hasCapSlice ? loadEdgesInto(capPolyData, capEdgePolyData) : false;
    syncEdgeVisibility();
  }

  function updateCapVisibility() {
    capActor.setVisibility(clipEnabled && hasCapSlice);
    syncPickList();
    syncEdgeVisibility();
  }

  // Clip plane control state
  let clipEnabled = model.clip_enabled || false;
  let clipNormal = model.clip_normal || [0, 0, 1]; // Current normal direction
  let clipOrigin = model.clip_origin || [0, 0, 0]; // Current origin position

  plane.setOrigin(clipOrigin[0], clipOrigin[1], clipOrigin[2]);
  plane.setNormal(clipNormal[0], clipNormal[1], clipNormal[2]);

  // Set initial visibility - clipActor visible when enabled, original actor hidden
  clipActor.setVisibility(clipEnabled);
  actor.setVisibility(!clipEnabled);

  // Update the local plane + fast preview while the widget is being dragged.
  // NOTE: this intentionally does NOT sync to python on every call - see
  // `onEndInteractionEvent` below, which is the only place that pushes the
  // plane state to python (i.e. on mouse release).
  widgetInstance.onStartInteractionEvent(() => {
    // A new drag is starting: whatever cap is currently shown is about to
    // be wrong for the plane position we're moving to, so hide it until
    // python sends a fresh slice for the new plane.
    capActor.setVisibility(false);
    syncPickList();
  });

  widgetInstance.onInteractionEvent(() => {
    const state = widgetInstance.getWidgetState();
    const normal = state.getNormal();
    const origin = state.getOrigin();

    clipOrigin = [origin[0], origin[1], origin[2]];
    clipNormal = [normal[0], normal[1], normal[2]];

    plane.setNormal(normal[0], normal[1], normal[2]);
    plane.setOrigin(origin[0], origin[1], origin[2]);

    plane.modified();
    clipper.modified();
    renderWindow.render();
  });

  widgetInstance.onEndInteractionEvent(() => {
    // Mouse released: this is the one point where we tell python the final
    // plane state, which triggers it to recompute the data-accurate cap
    // slice (plane ∩ real mesh) and send it back via `clip_slice`.
    syncClipStateToModel();
    refreshClipEdges();
  });

  // ----------------------------------------------------------------------------
  // Picker
  // ----------------------------------------------------------------------------

  const picker = vtkCellPicker.newInstance();
  picker.setPickFromList(true);
  // The default tolerance is a fairly generous world-space radius, meaning
  // the picker can snap to a *neighboring* cell instead of the one literally
  // under the cursor (especially on dense meshes, thin cells, or shallow
  // viewing angles). Tightening it makes picks track the exact cell more
  // reliably.
  picker.setTolerance(0.0005);

  // Keep the pick list limited to actors that are actually visible right
  // now. Previously all three actors (actor / clipActor / capActor) stayed
  // in the list permanently, even the ones hidden by setClipEnabled/
  // updateCapVisibility. Where a hidden actor's geometry sits behind or
  // coincident with the visible one, the picker could resolve a hit against
  // the *hidden* actor's cell - same screen location, wrong cell/dataset -
  // which shows up as an intermittently "off" hover/highlight, especially
  // near the clip boundary. Call this any time visibility changes.
  function syncPickList() {
    picker.initializePickList();
    if (actor.getVisibility()) picker.addPickList(actor);
    if (clipActor.getVisibility()) picker.addPickList(clipActor);
    if (capActor.getVisibility()) picker.addPickList(capActor);
  }
  syncPickList();

  // ----------------------------------------------------------------------------
  // Update PolyData
  // ----------------------------------------------------------------------------
  function updateGeometry(data) {
    if (!data) return;

    // Points
    const pts = toTyped(data.points?.buffer, data.points?.dtype || "float32");
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
    clipper.modified();
  }

  function updateScalars(data) {
    if (!data) return;

    // Point data
    const pd = polyData.getPointData();
    pd.initialize();

    Object.entries(data.pointData || {}).forEach(([name, entry], idx) => {
      const vtkArr = vtkDataArray.newInstance({
        name,
        values: toTyped(entry.buffer, entry.dtype),
        numberOfComponents: entry.components,
      });
      pd.addArray(vtkArr);
      if (idx === 0) pd.setScalars(vtkArr);
    });

    // Cell data
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
    clipper.modified();
  }

  // Load the python-computed slice (geometry + point/cell data combined in
  // one payload) into `capPolyData`.
  function updateCapSlice(data) {
    if (!data) {
      hasCapSlice = false;
      return;
    }

    const pts = toTyped(data.points?.buffer, data.points?.dtype || 'float32');
    if (pts) {
      const points = vtkPoints.newInstance();
      points.setData(pts, 3);
      capPolyData.setPoints(points);
    }

    capPolyData.setPolys(makeCellArray(data.polys));
    capPolyData.setLines(makeCellArray(data.lines));
    capPolyData.setVerts(makeCellArray(data.verts));
    capPolyData.setStrips(makeCellArray(data.strips));

    const pd = capPolyData.getPointData();
    pd.initialize();
    Object.entries(data.pointData || {}).forEach(([name, entry], idx) => {
      const vtkArr = vtkDataArray.newInstance({
        name,
        values: toTyped(entry.buffer, entry.dtype),
        numberOfComponents: entry.components,
      });
      pd.addArray(vtkArr);
      if (idx === 0) pd.setScalars(vtkArr);
    });

    const cd = capPolyData.getCellData();
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
    capPolyData.modified();

    hasCapSlice = true;
  }

  // ----------------------------------------------------------------------------
  // Clip Plane Controls
  // ----------------------------------------------------------------------------

  /**
   * Update clip plane position and orientation
   * The plane normal points to the side that will be REMOVED
   * @param {number[]} origin - [x, y, z] origin point for the plane
   * @param {number[]} normal - [x, y, z] normal vector (points to removed side)
   */
  function updateClipPlane(origin, normal) {
    if (origin) {
      clipOrigin = origin;
      plane.setOrigin(origin[0], origin[1], origin[2]);
    }
    if (normal) {
      clipNormal = normal;
      plane.setNormal(normal[0], normal[1], normal[2]);
    }

    plane.modified();
    clipper.modified();
    refreshClipEdges();
    // The current cap slice no longer matches this plane position; hide it
    // until python computes a fresh one (see `change:clip_slice` handler).
    capActor.setVisibility(false);
    syncPickList();
    syncWidgetFromPlane();
    renderWindow.render();
  }

  /**
   * Enable or disable clip plane visualization (ParaView style)
   * When enabled: shows geometry on one side of plane with intersection cap
   * When disabled: shows full original geometry
   * @param {boolean} enabled - Whether to show clipped geometry
   */
  function setClipEnabled(enabled) {
    clipEnabled = enabled;
    clipActor.setVisibility(enabled);
    actor.setVisibility(!enabled);
    updateCapVisibility();
    renderWindow.render();
  }

  /**
   * Move clip plane along its normal direction
   * @param {number} offset - Distance to move the plane
   */
  function moveClipPlane(offset) {
    const newOrigin = [
      clipOrigin[0] + clipNormal[0] * offset,
      clipOrigin[1] + clipNormal[1] * offset,
      clipOrigin[2] + clipNormal[2] * offset,
    ];

    updateClipPlane(newOrigin, null);
  }

  /**
   * Set clip plane normal to a cardinal direction
   * @param {'x' | 'y' | 'z'} axis - Axis for the normal direction
   * @param {number} sign - Direction sign (1 or -1)
   */
  function setClipAxis(axis, sign = 1) {
    let normal;
    switch (axis) {
      case 'x':
        normal = [sign, 0, 0];
        break;
      case 'y':
        normal = [0, sign, 0];
        break;
      case 'z':
      default:
        normal = [0, 0, sign];
        break;
    }
    updateClipPlane(null, normal);
  }

  /**
   * Auto-position clip plane at geometry center
   */
  function autoClipPlane() {
    const bounds = polyData.getBounds();
    const center = [
      (bounds[0] + bounds[1]) / 2,
      (bounds[2] + bounds[3]) / 2,
      (bounds[4] + bounds[5]) / 2,
    ];
    clipOrigin = center;
    plane.setOrigin(center[0], center[1], center[2]);
    clipper.modified();
    syncWidgetFromPlane();
    renderWindow.render();
  }

  // Auto-position clip plane on initial load
  autoClipPlane();

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

  // Initialize the widget with current geometry (after data is loaded)
  initializeWidget();

  refreshMainEdges();
  refreshClipEdges();

  // ----------------------------------------------------------------------------
  // Hover picking + hover cell highlight
  // ----------------------------------------------------------------------------
  let hoverEnabled = !!model.info;
  let lastHover = { cellId: -2, cellValue: null, position: [NaN, NaN, NaN], dataset: null };

  // --- Cell highlight state -----------------------------------------------
  // We darken the *actual* rgb cell-color tuple of whichever cell is under
  // the cursor, directly in whatever dataset it belongs to (the main
  // polyData, the clipper's output, or the cap slice) and restore the
  // original tuple when the hover moves off. This is cheap (touches a
  // single tuple) and works correctly no matter which of the three actors
  // was actually picked.
  const HOVER_DARKEN_OFFSET = 20 / 255;
  let highlight = null; // { array, cellId, original, dataset }

  function darkenTuple(tuple) {
    const out = new Array(tuple.length);
    for (let i = 0; i < tuple.length; i++) {
      // Leave an alpha component (4th channel), if present, untouched.
      out[i] = (tuple.length === 4 && i === 3)
        ? tuple[i]
        : Math.max(0, Math.min(1, tuple[i] - HOVER_DARKEN_OFFSET));
    }
    return out;
  }

  function clearHighlight() {
    if (!highlight) return;
    const { array, cellId, original, dataset } = highlight;
    array.setTuple(cellId, original);
    array.modified();
    dataset.modified();
    highlight = null;
  }

  function applyHighlight(dataset, cellId) {
    if (!dataset || cellId < 0) return;
    const cd = dataset.getCellData();
    const array = cd.getArrayByName('rgb');
    if (!array || cellId >= array.getNumberOfTuples()) return;

    const original = Array.from(array.getTuple(cellId));
    highlight = { array, cellId, original, dataset };
    array.setTuple(cellId, darkenTuple(original));
    array.modified();
    dataset.modified();
  }

  function updateHover(cellId, cellValue, world, dataset = null) {
    const x = world?.[0] ?? NaN;
    const y = world?.[1] ?? NaN;
    const z = world?.[2] ?? NaN;

    if (
      lastHover.cellId === cellId &&
      lastHover.cellValue === cellValue &&
      lastHover.dataset === dataset &&
      lastHover.position[0] === x &&
      lastHover.position[1] === y &&
      lastHover.position[2] === z
    ) {
      return;
    }

    // Swap the darken-highlight to the newly hovered cell (if any).
    if (highlight && (highlight.dataset !== dataset || highlight.cellId !== cellId)) {
      clearHighlight();
    }
    if (dataset && cellId >= 0 && !highlight) {
      applyHighlight(dataset, cellId);
    }

    lastHover = { cellId, cellValue, position: [x, y, z], dataset };
    model.hover_cell_id = cellId;
    model.hover_cell_value = cellValue ?? -1;
    model.hover_position = [x, y, z];
  }

  function onMouseMove(e) {
    if (!hoverEnabled) return;
    const rect = el.getBoundingClientRect();

    // CSS-pixel offset within the container - used only for tooltip DOM
    // placement, which must stay in CSS pixels.
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;

    // ------------------------------------------------------------------
    // Coordinate fix: the OpenGL render window's actual framebuffer can
    // be a different pixel size than el's CSS bounding rect (e.g. on any
    // display with devicePixelRatio != 1). Picking must happen in the
    // framebuffer's own pixel space, so we scale CSS coords by the ratio
    // between the real canvas size and its CSS size, rather than assuming
    // a 1:1 mapping. This is what was causing the growing offset between
    // the cursor and the picked point.
    // ------------------------------------------------------------------
    const [canvasWidth, canvasHeight] = openGLRenderWindow.getSize();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;

    const pickX = cssX * scaleX;
    const pickY = canvasHeight - cssY * scaleY; // vtk's Y axis is bottom-up

    picker.pick([pickX, pickY, 0], renderer);
    const pickedCellId = picker.getCellId();

    if (pickedCellId < 0) {
      tooltip.style.display = 'none';
      updateHover(-1, -1, null, null);
      return;
    }

    const world = picker.getPickPosition();

    // Use the dataset that was actually picked (polyData / clipper output /
    // capPolyData) rather than always reading from the original polyData -
    // clipActor and capActor have their own cell indexing.
    const dataset =
      (picker.getDataSet && picker.getDataSet()) ||
      (picker.getMapper() && picker.getMapper().getInputData()) ||
      polyData;

    const cellData = dataset.getCellData();
    const cellIdArray = cellData.getArrayByName('cell_id');
    const rgbaArray = cellData.getArrayByName('rgba');

    const cellValue = cellIdArray ? cellIdArray.getValue(pickedCellId) : 'N/A';
    const rgba = rgbaArray ? rgbaArray.getTuple(pickedCellId) : null;

    updateHover(pickedCellId, cellValue, world, dataset);
    renderWindow.render();

    tooltip.innerHTML = `
      <div><b>cell_id</b>: ${pickedCellId}</div>
      <div><b>cell_value</b>: ${cellValue}</div>
      <div><b>xyz</b>: ${world.map(v => v.toFixed(4)).join(', ')}</div>
      ${rgba ? `<div><b>rgba</b>: ${rgba.map(v => Math.round(v)).join(', ')}</div>` : ''}
    `;

    tooltip.style.left = `${cssX + 12}px`;
    tooltip.style.top = `${cssY + 12}px`;
    tooltip.style.display = 'block';
  }

  function onMouseLeave() {
    tooltip.style.display = 'none';
    updateHover(-1, -1, null, null);
    renderWindow.render();
  }

  function enableHover(enable) {
    hoverEnabled = enable;
    tooltip.style.display = 'none';
    if (!enable) {
      clearHighlight();
      lastHover = { cellId: -2, cellValue: null, position: [NaN, NaN, NaN], dataset: null };
      renderWindow.render();
    }
  }

  el.addEventListener('mousemove', onMouseMove);
  el.addEventListener('mouseleave', onMouseLeave);

  // Expose clip plane utilities globally for this instance
  window.vtkPanelClipPlane = {
    update: updateClipPlane,
    setEnabled: setClipEnabled,
    setPlaneVisible: setPlaneWidgetVisible,
    move: moveClipPlane,
    setAxis: setClipAxis,
    getState: () => ({
      enabled: clipEnabled,
      planeVisible: planeEnabled,
      origin: [...clipOrigin],
      normal: [...clipNormal],
    }),
  };

  // ----------------------------------------------------------------------------
  // Sync clip plane state to Python model
  // ----------------------------------------------------------------------------

  function syncClipStateToModel() {
    model.clip_enabled = clipEnabled;
    model.clip_origin = [...clipOrigin];
    model.clip_normal = [...clipNormal];
  }

  // Wrap updateClipPlane to sync after changes
  const originalUpdateClipPlane = updateClipPlane;
  updateClipPlane = (origin, normal) => {
    originalUpdateClipPlane(origin, normal);
    syncClipStateToModel();
  };

  // Wrap setClipEnabled to sync after changes
  const originalSetClipEnabled = setClipEnabled;
  setClipEnabled = (enabled) => {
    originalSetClipEnabled(enabled);
    syncClipStateToModel();
  };

  // ----------------------------------------------------------------------------
  // Keyboard Interaction for Clip Plane
  // ----------------------------------------------------------------------------

  const CLIP_OFFSET_FINE = 0.1;  // Fine movement with Shift
  const CLIP_OFFSET_COARSE = 1.0; // Normal movement

  function onKeyDown(e) {
    let handled = false;
    const offset = e.shiftKey ? CLIP_OFFSET_FINE : CLIP_OFFSET_COARSE;

    switch (e.key.toLowerCase()) {
      case 'c':
        // Toggle clip plane on/off
        setClipEnabled(!clipEnabled);
        handled = true;
        break;
      case 'x':
        setClipAxis('x', 1);
        handled = true;
        break;
      case 'y':
        setClipAxis('y', 1);
        handled = true;
        break;
      case 'z':
        setClipAxis('z', 1);
        handled = true;
        break;
      case 'v':
        setPlaneWidgetVisible(!planeEnabled);
        handled = true;
        break;
      case 'arrowup':
      case '+':
      case '=':
        moveClipPlane(offset);
        handled = true;
        break;
      case 'arrowdown':
      case '-':
      case '_':
        moveClipPlane(-offset);
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
    }
  }

  el.setAttribute('tabindex', '0');
  el.style.outline = 'none';
  el.addEventListener('keydown', onKeyDown);
  el.focus();

  // ----------------------------------------------------------------------------
  // Watch model updates
  // ----------------------------------------------------------------------------
  const onInfoChange = () => {
    const next = !!model.info;
    if (next !== hoverEnabled) enableHover(next);
  };

  // Listen for clip plane changes from Python
  model.on("change:clip_enabled", () => {
    setClipEnabled(model.clip_enabled);
  });

  model.on("change:clip_origin", () => {
    updateClipPlane(model.clip_origin, null);
  });

  model.on("change:clip_normal", () => {
    updateClipPlane(null, model.clip_normal);
  });

  // The data-accurate cap slice computed by python (plane ∩ real mesh).
  // Once it lands, show it (if clipping is currently enabled).
  model.on("change:clip_slice", () => {
    // The old cap dataset (and any highlight referencing it) is about to
    // be replaced - drop the stale reference.
    if (highlight && highlight.dataset === capPolyData) clearHighlight();
    updateCapSlice(model.clip_slice);
    updateCapVisibility();
    refreshCapEdges();
    renderWindow.render();
  });

  model.on("change:geometry", () => {
    // The whole pipeline's datasets get rebuilt - any in-progress highlight
    // is now stale.
    clearHighlight();
    lastHover = { cellId: -2, cellValue: null, position: [NaN, NaN, NaN], dataset: null };

    updateGeometry(model.geometry);
    // New geometry invalidates whatever cap slice we had.
    hasCapSlice = false;
    updateCapVisibility();
    // Re-auto-clip on geometry change
    autoClipPlane();
    syncClipStateToModel();
    renderUpdate(true);
    // Re-initialize widget bounds when geometry changes
    initializeWidget();
    syncWidgetFromPlane();
    refreshMainEdges();
    refreshClipEdges();
  });

  model.on("change:colors", () => {
    clearHighlight();
    lastHover = { cellId: -2, cellValue: null, position: [NaN, NaN, NaN], dataset: null };
    updateScalars(model.colors);
    renderUpdate(false);
    refreshMainEdges();
    refreshClipEdges();
  });

  model.on?.('change:info', onInfoChange);

  model.on("change:plane_visible", () => {
    setPlaneWidgetVisible(model.plane_visible);
  });

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
    el.removeEventListener('keydown', onKeyDown);
    model.off?.('change:geometry', updateGeometry);
    model.off?.('change:colors', updateScalars);
    model.off?.('change:info', onInfoChange);
    tooltip.remove();
    widgetManager.delete();
    genericRenderWindow.delete();
  };
}
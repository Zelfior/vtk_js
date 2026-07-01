import param
from panel.custom import JSComponent
import panel_material_ui as pmui

import numpy as np
import vtk

from vtk.util.numpy_support import vtk_to_numpy


# =============================================================================
# Binary helpers
# =============================================================================

def _pack(arr, dtype):
    return memoryview(arr.astype(dtype, copy=False)).tobytes()


def _vtk_to_numpy(vtk_array):
    return vtk_to_numpy(vtk_array)


# =============================================================================
# VTK 9.6+ SAFE CELL EXTRACTION
# =============================================================================

def extract_cell_stream(cell):
    """
    Convert VTK cell array (polys/lines/verts) into vtk.js-compatible stream.

    Uses modern VTK API:
    - GetOffsetsArray()
    - GetConnectivityArray()
    """

    if cell is None:
        return None

    offsets_vtk = cell.GetOffsetsArray()
    conn_vtk = cell.GetConnectivityArray()

    offsets = _vtk_to_numpy(offsets_vtk)
    conn = _vtk_to_numpy(conn_vtk)

    stream = []

    for i in range(len(offsets) - 1):

        start = offsets[i]
        end = offsets[i + 1]

        cell_pts = conn[start:end]

        stream.append(len(cell_pts))
        stream.extend(cell_pts.tolist())

    stream_np = np.array(stream, dtype=np.uint32)

    return {
        "buffer": memoryview(stream_np).tobytes(),
    }


# =============================================================================
# PolyData serialization (FAST / BINARY)
# =============================================================================

def polydata_to_dict(poly):
    """
    Convert vtkPolyData → vtk.js-friendly binary structure
    """

    # -------------------------------------------------------------------------
    # POINTS
    # -------------------------------------------------------------------------

    pts = _vtk_to_numpy(poly.GetPoints().GetData())

    points = {
        "buffer": _pack(pts, np.float32),
        "components": 3,
    }

    # -------------------------------------------------------------------------
    # TOPOLOGY
    # -------------------------------------------------------------------------

    def cell(cell):
        return extract_cell_stream(cell)

    polys = cell(poly.GetPolys())
    lines = cell(poly.GetLines())
    verts = cell(poly.GetVerts())
    strips = cell(poly.GetStrips())

    # -------------------------------------------------------------------------
    # POINT DATA
    # -------------------------------------------------------------------------

    point_data = {}
    pd = poly.GetPointData()

    for i in range(pd.GetNumberOfArrays()):

        arr = pd.GetArray(i)
        name = arr.GetName()

        np_arr = _vtk_to_numpy(arr)

        point_data[name] = {
            "buffer": memoryview(np_arr).tobytes(),
            "components": arr.GetNumberOfComponents(),
            "dtype": str(np_arr.dtype),
        }

    # -------------------------------------------------------------------------
    # CELL DATA
    # -------------------------------------------------------------------------

    cell_data = {}
    cd = poly.GetCellData()

    for i in range(cd.GetNumberOfArrays()):

        arr = cd.GetArray(i)
        name = arr.GetName()

        np_arr = _vtk_to_numpy(arr)

        cell_data[name] = {
            "buffer": _pack(np_arr, np.float32),
            "components": arr.GetNumberOfComponents(),
        }

    return {
        "points": points,

        "polys": polys,
        "lines": lines,
        "verts": verts,
        "strips": strips,

        "pointData": point_data,
        "cellData": cell_data,
    }


# =============================================================================
# Geometry creation
# =============================================================================

def create_uniform_structured_grid(nx, ny, nz, spacing=1.0):

    grid = vtk.vtkStructuredGrid()
    grid.SetDimensions(nx, ny, nz)

    pts = vtk.vtkPoints()

    for k in range(nz):
        for j in range(ny):
            for i in range(nx):

                pts.InsertNextPoint(
                    i * spacing,
                    j * spacing,
                    k * spacing,
                )

    grid.SetPoints(pts)
    n_cells = (nx - 1) * (ny - 1) * (nz - 1)

    cell_id = np.arange(n_cells, dtype=np.float32)

    x = np.arange((nx - 1), dtype=np.float32) / (nx - 2)
    y = np.arange((ny - 1), dtype=np.float32) / (ny - 2)
    z = np.arange((nz - 1), dtype=np.float32) / (nz - 2)

    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')  # 'ij' for Cartesian indexing

    X = X.flatten()
    Y = Y.flatten()
    Z = Z.flatten()

    rgb = np.stack(
        [
            X,          # red
            Y,    # green
            Z,    # blue
        ],
        axis=1,
    ).astype(np.float32)

    print(rgb.max(), rgb.min())

    grid.cell_data["cell_id"] = cell_id
    grid.cell_data["cell_value"] = X
    grid.cell_data["rgb"] = rgb

    print(grid.cell_data["rgb"])

    return grid


def structured_to_polydata(grid):

    geom = vtk.vtkGeometryFilter()
    geom.SetInputData(grid)
    geom.Update()

    return geom.GetOutput()


# =============================================================================
# Panel Component
# =============================================================================

class VTKPlotter(JSComponent):

    resolution = param.Integer(default=10, bounds=(4, 80))
    cmap = param.Selector(default="viridis", objects=["viridis", "plasma", "inferno", "magma"])
    info = param.Boolean(default=True)

    vtp_data = param.Dict()

    _importmap = {
        "imports": {
            "@kitware/vtk.js": "https://esm.sh/@kitware/vtk.js@35.15.1",
        }
    }

    _esm = "./src/app.js"

    def __init__(self, poly_data, **params):

        super().__init__(**params)
        self.data = poly_data
        self._update_vtp_data()

        self.param.watch(self._update_vtp_data, "resolution")
        self.param.watch(self._update_vtp_data, "cmap")

    def _update_vtp_data(self, event=None):

        self.vtp_data = polydata_to_dict(self.data)


# =============================================================================
# UI
# =============================================================================

if __name__ == "__main__":

    resolution_slider = pmui.IntSlider(
        name="Resolution",
        start=4,
        end=80,
        sizing_mode="stretch_width",
        value=10,
    )

    cmap = pmui.Select(
        name="Colormap",
        options=["viridis", "plasma", "inferno", "magma"],
        sizing_mode="stretch_width",
    )

    info_checkbox = pmui.Checkbox(
        name="Show Info",
        value=True,
    )

    vtk_view = VTKPlotter(sizing_mode="stretch_both")

    resolution_slider.link(vtk_view, value="resolution")
    cmap.link(vtk_view, value="cmap")
    info_checkbox.link(vtk_view, value="info")

    pmui.Row(
        pmui.Column(
            resolution_slider,
            cmap,
            info_checkbox,
            width=300,
        ),
        vtk_view,
        sizing_mode="stretch_both",
    ).show()

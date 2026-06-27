import param
from panel.custom import JSComponent
from vtk.util.numpy_support import vtk_to_numpy
import numpy as np

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

        # "pointData": point_data,
        "cellData": cell_data,
    }


class VTKPlotter(JSComponent):

    vtp_data = param.Dict()

    _importmap = {
        "imports": {
            "@kitware/vtk.js": "https://esm.sh/@kitware/vtk.js@35.15.1",
        }
    }

    _esm = "VTKPlotter.bundle.js"

    def __init__(self, **params):
        super().__init__(**params)

    def update_polydata(self, polydata):
        self.vtp_data = polydata_to_dict(polydata)

    def update_colors(self, polydata):
        # Update the VTKPlotter with new polydata
        new_data = polydata_to_dict(polydata)

        # self.vtp_data["pointData"] = new_data["pointData"]
        self.vtp_data["cellData"] = new_data["cellData"]
        

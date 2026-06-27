import param
import vtk
import numpy as np
import panel_material_ui as pmui
from plotter import VTKPlotter, polydata_to_dict
import matplotlib.pyplot as plt  # For colormaps

# =============================================================================
# Geometry creation
# =============================================================================
def set_color(polydata: vtk.vtkPolyData, cmap: str = "viridis"):
    """
    Set color for the given vtkPolyData using the specified colormap.
    If the 'rgb' array already exists, it is replaced; otherwise, it is added.
    """
    # Get the cell_value array
    cell_data = polydata.GetCellData()
    cell_value_array = cell_data.GetArray("cell_value")
    cell_value = vtk.util.numpy_support.vtk_to_numpy(cell_value_array)

    # Normalize cell_value to [0, 1]
    norm_values = (cell_value - cell_value.min()) / (cell_value.max() - cell_value.min())

    # Map normalized values to RGB using the colormap
    cmap_obj = plt.get_cmap(cmap)
    rgb = cmap_obj(norm_values)[:, :3]  # Get RGB (ignore alpha)

    # Convert RGB to VTK array
    rgb_array = vtk.util.numpy_support.numpy_to_vtk(
        rgb, deep=True, array_type=vtk.VTK_FLOAT
    )
    rgb_array.SetNumberOfComponents(3)
    rgb_array.SetName("rgb")

    # Remove existing 'rgb' array if it exists
    if cell_data.GetArray("rgb") is not None:
        cell_data.RemoveArray("rgb")

    # Add the new RGB array
    cell_data.AddArray(rgb_array)
    
def create_uniform_structured_grid(nx, ny, nz, spacing=1.0, cmap="viridis"):
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

    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    X = X.flatten()
    Y = Y.flatten()
    Z = Z.flatten()

    grid.cell_data["cell_id"] = cell_id
    grid.cell_data["cell_value"] = X

    set_color(grid, cmap=cmap)

    return grid

def create_sliced_sphere(theta_count: int, phi_count: int, cmap="viridis") -> vtk.vtkPolyData:
    sphere: vtk.vtkSphereSource = vtk.vtkSphereSource()
    sphere.SetThetaResolution(theta_count)
    sphere.SetPhiResolution(phi_count)
    sphere.Update()

    polydata: vtk.vtkPolyData = sphere.GetOutput()
    num_cells = polydata.GetNumberOfCells()
    cell_id = np.arange(num_cells, dtype=np.int32)
    cell_value = cell_id.astype(np.float32)

    # Use the selected colormap to map scalar values to RGB
    cmap_obj = plt.get_cmap(cmap)
    norm_values = (cell_value - cell_value.min()) / (cell_value.max() - cell_value.min())
    rgb = cmap_obj(norm_values)[:, :3]  # Get RGB (ignore alpha)

    # Convert numpy arrays to VTK arrays
    cell_id_array = vtk.util.numpy_support.numpy_to_vtk(
        cell_id, deep=True, array_type=vtk.VTK_ID_TYPE
    )
    cell_value_array = vtk.util.numpy_support.numpy_to_vtk(
        cell_value, deep=True, array_type=vtk.VTK_FLOAT
    )
    # Assign arrays to cell data
    polydata.GetCellData().AddArray(cell_id_array)
    polydata.GetCellData().AddArray(cell_value_array)

    polydata.GetCellData().GetArray(0).SetName("cell_id")
    polydata.GetCellData().GetArray(1).SetName("cell_value")

    # Create and assign RGB array
    set_color(polydata, cmap=cmap)

    return polydata

def structured_to_polydata(grid):
    geom = vtk.vtkGeometryFilter()
    geom.SetInputData(grid)
    geom.Update()
    return geom.GetOutput()

class ExamplePanel(param.Parameterized):
    resolution_theta = param.Integer(default=10, bounds=(4, 80))
    resolution_phi = param.Integer(default=10, bounds=(4, 80))
    cmap = param.Selector(default="viridis", objects=["viridis", "plasma", "inferno", "magma"])
    geometry_type = param.Selector(default="sliced_sphere", objects=["sliced_sphere", "structured_grid"])

    def __init__(self, **params):
        super().__init__(**params)
        self.param.watch(self._update_vtp_data, ["resolution_theta", "resolution_phi", "geometry_type"])
        self.param.watch(self._update_color, ["cmap"])

        self.poly = create_sliced_sphere(
            theta_count=self.resolution_theta,
            phi_count=self.resolution_phi,
            cmap=self.cmap,
        )

        self.theta_slider = pmui.IntSlider(
            name="Resolution Theta",
            start=4,
            end=80,
            sizing_mode="stretch_width",
            value=10,
        )
        self.phi_slider = pmui.IntSlider(
            name="Resolution Phi",
            start=4,
            end=80,
            sizing_mode="stretch_width",
            value=10,
        )
        self.cmap_select = pmui.Select(
            name="Colormap",
            options=["viridis", "plasma", "inferno", "magma"],
            sizing_mode="stretch_width",
        )
        self.geom_select = pmui.Select(
            name="Geometry Type",
            options=["sliced_sphere", "structured_grid"],
            sizing_mode="stretch_width",
        )
        self.vtk_view = VTKPlotter(vtp_data = polydata_to_dict(self.poly), sizing_mode="stretch_both")

    def show(self):
        pmui.Row(
            pmui.Column(
                self.geom_select,
                self.theta_slider,
                self.phi_slider,
                self.cmap_select,
                width=300,
            ),
            self.vtk_view,
            sizing_mode="stretch_both",
        ).show()

    def _update_vtp_data(self, event=None):
        if self.geom_select.value == "structured_grid":
            grid = create_uniform_structured_grid(
                nx=self.resolution_theta,
                ny=self.resolution_phi,
                nz=self.resolution_phi,
                spacing=1.0 / self.resolution_theta,
                cmap=self.cmap,
            )
            poly = structured_to_polydata(grid)
        else:
            poly = create_sliced_sphere(
                theta_count=self.resolution_theta,
                phi_count=self.resolution_phi,
                cmap=self.cmap,
            )

        self.poly = poly
        self.vtk_view.update_polydata(poly)

    def _update_color(self, event=None):
        set_color(self.poly, cmap=self.cmap)
        self.vtk_view.update_polydata(self.poly)

if __name__ == "__main__":
    ExamplePanel().show()
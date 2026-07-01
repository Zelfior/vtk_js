import param
import numpy as np
import panel_material_ui as pmui
from plotter import VTKPlotter, polydata_to_dict
import matplotlib.pyplot as plt  # For colormaps
import pyvista as pv

# =============================================================================
# Geometry creation
# =============================================================================
def set_color(polydata: pv.PolyData, cmap: str = "viridis"):
    """
    Set color for the given pyvista.PolyData using the specified colormap.
    If the 'rgb' array already exists, it is replaced; otherwise, it is added.
    """
    # Get the cell_values array
    cell_value = polydata["cell_value"]

    # Normalize cell_value to [0, 1]
    norm_values = (cell_value - cell_value.min()) / (cell_value.max() - cell_value.min())

    # Map normalized values to RGB using the colormap
    cmap_obj = plt.get_cmap(cmap)
    rgb = cmap_obj(norm_values)[:, :3]  # Get RGB (ignore alpha)

    # Assign the RGB array to cell data
    polydata["rgb"] = rgb

def create_uniform_structured_grid(nx, ny, nz, spacing=1.0, cmap="viridis"):
    """Create a uniform structured grid using pyvista"""
    # Create coordinate arrays matching the original vtk behavior
    x = np.arange(nx, dtype=np.float32) * spacing / nx
    y = np.arange(ny, dtype=np.float32) * spacing / ny
    z = np.arange(nz, dtype=np.float32) * spacing / nz
    
    # Create meshgrid for the structured grid (structured grid expects this format)
    X, Y, Z = np.meshgrid(x, y, z, indexing='ij')
    
    # Create structured grid directly from coordinate arrays
    grid = pv.StructuredGrid(X, Y, Z)
    
    # Calculate cell values matching original vtk behavior
    n_cells = (nx - 1) * (ny - 1) * (nz - 1)
    cell_id = np.arange(n_cells, dtype=np.float32)
    
    # Handle edge cases for normalization (avoid division by zero)
    x_norm = np.arange(max(nx - 1, 1), dtype=np.float32)
    y_norm = np.arange(max(ny - 1, 1), dtype=np.float32)
    z_norm = np.arange(max(nz - 1, 1), dtype=np.float32)
    
    if nx > 1:
        x_norm = x_norm / (nx - 2) if nx > 2 else x_norm
    if ny > 1:
        y_norm = y_norm / (ny - 2) if ny > 2 else y_norm
    if nz > 1:
        z_norm = z_norm / (nz - 2) if nz > 2 else z_norm
    
    X_c, Y_c, Z_c = np.meshgrid(x_norm, y_norm, z_norm, indexing='ij')
    cell_value = X_c.flatten()
    
    # Ensure cell data arrays match the number of cells
    if len(cell_value) != n_cells:
        # Trim or pad to match
        cell_value = cell_value[:n_cells]
        if len(cell_value) < n_cells:
            cell_value = np.pad(cell_value, (0, n_cells - len(cell_value)))
    
    grid.cell_data["cell_id"] = cell_id
    grid.cell_data["cell_value"] = cell_value
    
    # Convert to PolyData for visualization
    poly = grid.extract_geometry()
    set_color(poly, cmap=cmap)
    
    return poly

def create_sliced_sphere(theta_count: int, phi_count: int, cmap="viridis") -> pv.PolyData:
    """Create a sliced sphere using pyvista"""
    # Create sphere using pyvista
    sphere = pv.Sphere(theta_resolution=theta_count, phi_resolution=phi_count)
    
    num_cells = sphere.n_cells
    cell_id = np.arange(num_cells, dtype=np.int32)
    cell_value = cell_id.astype(np.float32)
    
    # Add cell data
    sphere.cell_data["cell_id"] = cell_id
    sphere.cell_data["cell_value"] = cell_value
    
    # Use the selected colormap to map scalar values to RGB
    cmap_obj = plt.get_cmap(cmap)
    norm_values = (cell_value - cell_value.min()) / (cell_value.max() - cell_value.min())
    rgb = cmap_obj(norm_values)[:, :3]  # Get RGB (ignore alpha)
    
    # Create and assign RGB array
    set_color(sphere, cmap=cmap)
    
    return sphere

def structured_to_polydata(grid):
    """Convert structured grid to polydata using pyvista"""
    return grid.extract_geometry()

class ExamplePanel(param.Parameterized):
    def __init__(self, **params):
        super().__init__(**params)
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
        self.display_info = pmui.Checkbox(
            name="Display Info",
            value=True,
            sizing_mode="stretch_width",
        )

        self.theta_slider.param.watch(self._update_vtp_data, "value")
        self.phi_slider.param.watch(self._update_vtp_data, "value")
        self.cmap_select.param.watch(self._update_color, "value")
        self.geom_select.param.watch(self._update_vtp_data, "value")
        self.display_info.param.watch(self._update_info_display, "value")

        self.poly = create_sliced_sphere(
            theta_count=self.theta_slider.value,
            phi_count=self.phi_slider.value,
            cmap=self.cmap_select.value,
        )

        self.description = pmui.Typography(
            """
            Hover to update...
            """
        )

        self.vtk_view = VTKPlotter(sizing_mode="stretch_both")
        self.vtk_view.update_polydata(self.poly)

        self.vtk_view.param.watch(self.update_description, "hover_cell_id")
        self.vtk_view.param.watch(self.update_description, "hover_cell_value")
        self.vtk_view.param.watch(self.update_description, "hover_position")

    def update_description(self, event=None):
        self.description.object = f"""
        Hovered Cell ID: {self.vtk_view.hover_cell_id}
        Hovered Cell Value: {self.vtk_view.hover_cell_value}

        Hovered Coordinates:

        - X : {self.vtk_view.hover_position[0]:.3f}
        - Y : {self.vtk_view.hover_position[1]:.3f}
        - Z : {self.vtk_view.hover_position[2]:.3f}
        """

    def show(self):
        pmui.Row(
            pmui.Column(
                self.geom_select,
                self.theta_slider,
                self.phi_slider,
                self.cmap_select,
                self.display_info,
                self.description,
                width=300,
            ),
            self.vtk_view,
            sizing_mode="stretch_both",
        ).show()

    def _update_vtp_data(self, event=None):
        print("Updating VTKPlotter data...")
        if self.geom_select.value == "structured_grid":
            poly = create_uniform_structured_grid(
                nx=self.theta_slider.value,
                ny=self.phi_slider.value,
                nz=self.phi_slider.value,
                spacing=1.0 / self.theta_slider.value,
                cmap=self.cmap_select.value,
            )
        else:
            poly = create_sliced_sphere(
                theta_count=self.theta_slider.value,
                phi_count=self.phi_slider.value,
                cmap=self.cmap_select.value,
            )

        self.poly = poly
        self.vtk_view.update_polydata(poly)

    def _update_color(self, event=None):
        print("Updating VTKPlotter colors...")
        set_color(self.poly, cmap=self.cmap_select.value)
        self.vtk_view.update_colors(self.poly)

    def _update_info_display(self, event=None):
        self.vtk_view.info = self.display_info.value
    
if __name__ == "__main__":
    ExamplePanel().show()
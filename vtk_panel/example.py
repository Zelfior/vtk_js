import param
import numpy as np
import panel_material_ui as pmui
from plotter import VTKPlotter, polydata_to_dict
import matplotlib.pyplot as plt  # For colormaps
import pyvista as pv

# =============================================================================
# Geometry creation
# =============================================================================
def set_color(polydata: pv.DataSet, cmap: str = "viridis"):
    """
    Set color for the given pyvista mesh using the specified colormap.
    If the 'rgb' array already exists, it is replaced; otherwise, it is added.
    
    Supports PolyData and UnstructuredGrid.
    """
    # Get the cell_values array
    if "cell_value" not in polydata.cell_data:
        # Create a default cell_value if not present
        n_cells = polydata.n_cells
        polydata.cell_data["cell_value"] = np.arange(n_cells, dtype=np.float32)
    
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
    
    # Convert to PolyData for visualization using extract_surface to get proper polygons
    # This preserves cell data through vtkOriginalCellIds
    poly = grid.extract_surface(algorithm='dataset_surface')
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


def create_unstructured_grid(n_points: int = 100, n_cells: int = 50, cmap="viridis") -> pv.UnstructuredGrid:
    """
    Create an unstructured grid with random tetrahedral cells using pyvista.
    
    Args:
        n_points: Number of random points to generate
        n_cells: Number of tetrahedral cells to create
        cmap: Colormap to use for cell coloring
    
    Returns:
        pv.UnstructuredGrid with cell data
    """
    # Generate random points in a unit cube
    np.random.seed(42)  # For reproducibility
    points = np.random.rand(n_points, 3)
    
    # Create tetrahedral cells by randomly selecting 4 points for each cell
    # Make sure we don't select the same point twice in a cell
    cells = []
    cell_types = []
    
    for i in range(n_cells):
        # Select 4 unique random point indices
        cell_indices = np.random.choice(n_points, size=4, replace=False)
        cells.append(cell_indices)
        cell_types.append(pv.CellType.TETRA)
    
    # Create the unstructured grid
    ugrid = pv.UnstructuredGrid(cells, cell_types, points)
    
    # Add cell data
    cell_id = np.arange(n_cells, dtype=np.int32)
    cell_value = cell_id.astype(np.float32)
    
    ugrid.cell_data["cell_id"] = cell_id
    ugrid.cell_data["cell_value"] = cell_value
    
    # Apply colormap
    set_color(ugrid, cmap=cmap)
    
    return ugrid


def create_random_tetrahedral_mesh(n_tetras: int = 20, seed: int = 42, cmap="viridis") -> pv.UnstructuredGrid:
    """
    Create a random tetrahedral mesh spread in space.
    
    Args:
        n_tetras: Number of tetrahedra to create
        seed: Random seed for reproducibility
        cmap: Colormap to use for cell coloring
    
    Returns:
        pv.UnstructuredGrid with properly connected tetrahedra
    """
    np.random.seed(seed)
    
    # Create points by generating random tetrahedra
    # Each tetra needs 4 points, but we'll share some points between adjacent tetras
    all_points = []
    cell_connectivity = []  # Flat connectivity array
    
    # Start with a base set of points (8 corners of a cube)
    base_points = np.random.rand(8, 3) * 2 - 1  # Points in [-1, 1] cube
    all_points.extend(base_points.tolist())
    
    # Create initial tetrahedra from the base points
    # A cube can be divided into 5-6 tetrahedra
    tetra_configs = [
        [0, 1, 3, 4], [1, 2, 3, 4], [1, 3, 7, 4], [3, 5, 7, 4], [3, 6, 7, 5], [1, 3, 5, 7]
    ]
    
    for config in tetra_configs[:min(n_tetras, len(tetra_configs))]:
        # PyVista expects: [n_points, p0, p1, p2, p3] for each cell
        cell_connectivity.extend([4] + list(config))
    
    # Add more random tetrahedra if needed
    current_n_tetras = len(tetra_configs[:min(n_tetras, len(tetra_configs))])
    while current_n_tetras < n_tetras:
        # Create new points for additional tetrahedra
        offset = np.random.rand(3) * 4 - 2  # Random offset in [-2, 2]
        new_points = np.random.rand(4, 3) + offset
        
        start_idx = len(all_points)
        all_points.extend(new_points.tolist())
        
        # Add cell with format: [4, p0, p1, p2, p3]
        cell_connectivity.extend([4, start_idx, start_idx + 1, start_idx + 2, start_idx + 3])
        current_n_tetras += 1
    
    # Create the unstructured grid using pyvista's helper
    points_array = np.array(all_points, dtype=np.float64)
    
    # Create cell types array (one TETRA per cell)
    n_cells = len(cell_connectivity) // 5  # Each cell has 5 values: [4, p0, p1, p2, p3]
    cell_types = np.full(n_cells, pv.CellType.TETRA, dtype=np.uint8)
    
    # Create the unstructured grid
    ugrid = pv.UnstructuredGrid(np.array(cell_connectivity, dtype=np.int64), cell_types, points_array)
    
    # Add cell data
    cell_id = np.arange(n_cells, dtype=np.int32)
    cell_value = cell_id.astype(np.float32)
    
    ugrid.cell_data["cell_id"] = cell_id
    ugrid.cell_data["cell_value"] = cell_value
    
    # Apply colormap
    set_color(ugrid, cmap=cmap)
    
    return ugrid


class ExamplePanel(param.Parameterized):
    def __init__(self, **params):
        super().__init__(**params)
        self.theta_slider = pmui.IntSlider(
            label="Resolution Theta",
            start=4,
            end=80,
            sizing_mode="stretch_width",
            value=10,
        )
        self.phi_slider = pmui.IntSlider(
            label="Resolution Phi",
            start=4,
            end=80,
            sizing_mode="stretch_width",
            value=10,
        )
        self.cmap_select = pmui.Select(
            label="Colormap",
            options=["viridis", "plasma", "inferno", "magma"],
            sizing_mode="stretch_width",
        )
        self.geom_select = pmui.Select(
            label="Geometry Type",
            options=["sliced_sphere", "structured_grid", "unstructured_grid"],
            sizing_mode="stretch_width",
        )
        self.display_info = pmui.Checkbox(
            label="Display Info",
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
            mesh = create_uniform_structured_grid(
                nx=self.theta_slider.value,
                ny=self.phi_slider.value,
                nz=self.phi_slider.value,
                spacing=1.0 / self.theta_slider.value,
                cmap=self.cmap_select.value,
            )
        elif self.geom_select.value == "unstructured_grid":
            mesh = create_random_tetrahedral_mesh(
                n_tetras=max(self.theta_slider.value * 2, 10),
                seed=42,
                cmap=self.cmap_select.value,
            )
        else:
            mesh = create_sliced_sphere(
                theta_count=self.theta_slider.value,
                phi_count=self.phi_slider.value,
                cmap=self.cmap_select.value,
            )

        self.poly = mesh
        self.vtk_view.update_polydata(mesh)

    def _update_color(self, event=None):
        print("Updating VTKPlotter colors...")
        set_color(self.poly, cmap=self.cmap_select.value)
        self.vtk_view.update_colors(self.poly)

    def _update_info_display(self, event=None):
        self.vtk_view.info = self.display_info.value
    
if __name__ == "__main__":
    ExamplePanel().show()
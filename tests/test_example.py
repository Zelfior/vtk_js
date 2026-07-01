"""Tests for ExamplePanel with all geometry options."""
import pytest
from vtk_panel.example import ExamplePanel


def test_example_panel_sphere():
    """Test ExamplePanel with sliced_sphere geometry."""
    panel = ExamplePanel()
    
    # Set geometry to sphere
    panel.geom_select.value = "sliced_sphere"
    
    # Trigger theta slider update
    initial_theta = panel.theta_slider.value
    panel.theta_slider.value = 20
    
    # Verify mesh was updated
    assert panel.poly is not None
    assert panel.poly.n_cells > 0


def test_example_panel_structured_grid():
    """Test ExamplePanel with structured_grid geometry."""
    panel = ExamplePanel()
    
    # Set geometry to structured grid
    panel.geom_select.value = "structured_grid"
    
    # Trigger theta slider update
    panel.theta_slider.value = 15
    
    # Verify mesh was updated
    assert panel.poly is not None
    assert panel.poly.n_cells > 0


def test_example_panel_unstructured_grid():
    """Test ExamplePanel with unstructured_grid geometry."""
    panel = ExamplePanel()
    
    # Set geometry to unstructured grid
    panel.geom_select.value = "unstructured_grid"
    
    # Trigger theta slider update
    panel.theta_slider.value = 12
    
    # Verify mesh was updated
    assert panel.poly is not None
    assert panel.poly.n_cells > 0


def test_example_panel_colormap_change():
    """Test ExamplePanel colormap change."""
    panel = ExamplePanel()
    
    # Change colormap
    panel.cmap_select.value = "plasma"
    
    # Verify rgb array exists
    assert "rgb" in panel.poly.cell_data


def test_example_panel_display_info():
    """Test ExamplePanel display info toggle."""
    panel = ExamplePanel()
    
    # Toggle display info
    panel.display_info.value = False
    assert panel.vtk_view.info is False
    
    panel.display_info.value = True
    assert panel.vtk_view.info is True
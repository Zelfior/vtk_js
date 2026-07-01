
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union
import numpy as np
import multiprocessing as mp

import panel_material_ui as pmui
import panel as pn
import pyvista as pv
import vtk

import scivianna
from scivianna.extension.extension import Extension
from scivianna.panel.visualisation_panel import VisualizationPanel
from scivianna.plotter_2d.generic_plotter import Plotter2D
from scivianna.slave import ComputeSlave

from scivianna.interface.generic_interface import Geometry2DPolygon
from scivianna.interface import csv_result
from scivianna.utils.polygonize_tools import PolygonCoords, PolygonElement
from scivianna.enums import GeometryType, VisualizationMode
from scivianna.constants import MESH, GEOMETRY, CSV
from scivianna.data.data2d import Data2D

from vtk_viewer import VTKCone

file_path = Path("/partage/spatial/Stages/2026_Manta_NTP/Results/Core/core_vtk/core.20.vtm")
reader = vtk.vtkXMLMultiBlockDataReader()
reader.SetFileName(file_path) 
reader.Update()

mesh = None
data = reader.GetOutput()

append = vtk.vtkAppendFilter()

def add_blocks(block):
    if block is None:
        return

    if block.IsA("vtkUnstructuredGrid"):
        append.AddInputData(block)

    elif block.IsA("vtkMultiBlockDataSet"):
        for i in range(block.GetNumberOfBlocks()):
            add_blocks(block.GetBlock(i))

    elif block.IsA("vtkMultiPieceDataSet"):
        for i in range(block.GetNumberOfPieces()):
            add_blocks(block.GetPiece(i))

# Traverse everything
add_blocks(data)

append.Update()

mesh: pv.UnstructuredGrid = pv.wrap(append.GetOutput())
mesh = mesh.point_data_to_cell_data()
mesh.cell_data["cell_id"] = list(range(mesh.number_of_cells))
mesh.cell_data["rgb"] = np.stack([
    np.arange(mesh.number_of_cells) / mesh.number_of_cells,
    np.arange(mesh.number_of_cells) / mesh.number_of_cells,
    np.arange(mesh.number_of_cells) / mesh.number_of_cells,
], axis=1)

cone = VTKCone(mesh.cast_to_poly_points(pass_cell_data=True))

cone.show()
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Point {
  x: number;
  y: number;
}

export interface MeasurementLine {
  p1: Point;
  p2: Point | null;
}

export interface BaseAsset {
  id: number;
  name: string;
  notes: string;
  x: number;
  y: number;
}

export interface BinAsset extends BaseAsset {
  type: 'bin';
  diameter: string;
  rings: string;
  eaveHeight: string;
  totalHeight: string;
  floorThick: string;
  measurements: MeasurementLine[];
  centerCable?: string;
  radiusCable?: string;
}

export interface MarkerAsset extends BaseAsset {
  type: 'chester-x' | 'chester-x1' | 'junction-box';
  diameter: string;
}

export interface ZoneAsset extends BaseAsset {
  type: 'zone';
  width: string;
  height: string;
}

export type Asset = BinAsset | MarkerAsset | ZoneAsset;

export interface Yard {
  id: number;
  name: string;
  location?: string;
  bins: Asset[];
}

export interface Customer {
  name: string;
  phone: string;
  email?: string;
  location?: string;
}

export interface Project {
  name: string;
  customer: Customer;
  date: string;
  activeYardId: number | null;
  yards: Yard[];
}

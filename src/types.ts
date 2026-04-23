export type Region = "east" | "west";

export interface Tradition {
  id: string;
  label: string;
  labelKo: string;
  region: Region;
  color: string;
}

export interface Philosopher {
  id: string;
  name: string;
  nameKo: string;
  birth: number;
  death: number;
  region: Region;
  tradition: string;
  desc: string;
  influences: string[];
}

export interface Dataset {
  traditions: Tradition[];
  philosophers: Philosopher[];
}

export interface LaidOutPhilosopher extends Philosopher {
  x: number;
  y: number;
  lineColor: string;
}

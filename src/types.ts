export type Region = "east" | "west";

export interface Tradition {
  id: string;
  label: string;
  labelKo: string;
  region: Region;
  color: string;
}

export interface Quote {
  text: string;
  source?: string;
}

export interface LifeEvent {
  year: number;
  text: string;
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
  topics?: string[];
  quotes?: Quote[];
  events?: LifeEvent[];
}

export interface Topic {
  id: string;
  labelKo: string;
  color: string;
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

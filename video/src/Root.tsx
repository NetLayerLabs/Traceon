import React from "react";
import { Composition, Still } from "remotion";
import { Film, TITLE } from "./Film";
import { Poster } from "./Poster";
import { T } from "./timing";

export const Root: React.FC = () => (
  <>
    <Composition id="Traceon" component={Film} durationInFrames={T.totalFrames + TITLE} fps={T.fps} width={1920} height={1080} />
    <Still id="Poster" component={Poster} width={1920} height={1080} />
  </>
);

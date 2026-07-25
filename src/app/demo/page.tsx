import type { Metadata } from "next";
import { DemoWorkspace } from "@/components/demo/demo-workspace";

export const metadata: Metadata = {
  title: "Demo workspace",
  description: "Explore the isolated Move Atlas curated sample workspace.",
};

export default function DemoPage() {
  return <DemoWorkspace />;
}

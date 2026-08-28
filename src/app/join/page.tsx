import { JoinDialog } from "./join-dialog";

type JoinPageProps = {
  searchParams: Promise<{ invalid?: string }>;
};

export default async function JoinIndexPage({ searchParams }: JoinPageProps) {
  const { invalid } = await searchParams;
  return <JoinDialog invalidCode={invalid === "1"} />;
}

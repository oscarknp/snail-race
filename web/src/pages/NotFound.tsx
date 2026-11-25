import { Link } from "react-router-dom";
import { Empty } from "../components/ui.tsx";

export function NotFound() {
  return (
    <main className="page container">
      <div className="card">
        <Empty title="This page has flown off course" emoji="🧭">
          <p>We checked every runway. <Link to="/">Back to the race</Link></p>
        </Empty>
      </div>
    </main>
  );
}

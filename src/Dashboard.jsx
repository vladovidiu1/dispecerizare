import React from "react";
export default function Dashboard({ data }) {
  if (!data) return <p>Se încarcă indicatorii…</p>;
  const { daily, categories, agents, summary } = data;
  const max = Math.max(1, ...daily.flatMap((d) => [d.received, d.resolved]));
  return (
    <div className="dashboard-grid">
      <section className="panel dashboard-panel">
        <h3>Fluxul ultimelor 7 zile</h3>
        <p>
          Taskuri create <i className="chart-key incoming" /> · rezolvate{" "}
          <i className="chart-key solved" />
        </p>
        <div className="daily-chart">
          {daily.map((d) => (
            <div className="chart-day" key={d.day}>
              <div className="chart-bars">
                <div
                  className="chart-bar incoming"
                  style={{ height: (d.received / max) * 100 + "%" }}
                  title={d.received + " taskuri create"}
                >
                  <span>{d.received}</span>
                </div>
                <div
                  className="chart-bar solved"
                  style={{ height: (d.resolved / max) * 100 + "%" }}
                  title={d.resolved + " rezolvate"}
                >
                  <span>{d.resolved}</span>
                </div>
              </div>
              <small>
                {new Date(d.day + "T12:00:00").toLocaleDateString("ro-RO", {
                  day: "2-digit",
                  month: "2-digit",
                })}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section className="panel dashboard-panel">
        <h3>Încărcarea echipei</h3>
        <p>
          {summary.unassigned} taskuri deschise fără agent · {summary.working}{" "}
          în lucru
        </p>
        <div className="dashboard-list">
          {agents.map((a) => (
            <div key={a.id}>
              <div className="metric-label">
                <span>
                  {a.name}
                  {!a.available ? " · indisponibil" : ""}
                </span>
                <strong>
                  {a.load} / {a.capacity}
                </strong>
              </div>
              <div className="metric-track">
                <i
                  style={{
                    width: Math.min(100, (a.load / a.capacity) * 100) + "%",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel dashboard-panel category-dashboard">
        <h3>Solicitări pe competențe</h3>
        <div className="category-metrics">
          {categories.map((c) => (
            <div key={c.name}>
              <span>{c.name}</span>
              <strong>{c.open} deschise</strong>
              <small>{c.total} în total</small>
            </div>
          ))}
        </div>
        {!categories.length && (
          <p>Indicatorii vor apărea după primele solicitări.</p>
        )}
      </section>
    </div>
  );
}

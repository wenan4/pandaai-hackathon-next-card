import "./style.css";
import { isJudgeMode, renderPanel } from "./panel";
import { renderFooter } from "./ui/footer";
import { renderHome } from "./ui/home";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.append(isJudgeMode() ? renderPanel() : renderHome(), renderFooter());
